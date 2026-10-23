#!/usr/bin/env bash
# F-1 author DB run on a RUN-UNIQUE, socket-only PostgreSQL cluster (t604).
# - never touches system clusters: creates its own data dir under a fresh mktemp dir
# - listen_addresses='' (no TCP), unix socket only in the run dir (0700), peer auth
#   mapped from the current OS user, no password, no host lines
# - verifies endpoint (socket dir, data_directory, version, no TCP) before any test;
#   any mismatch -> BLOCKED (exit 3) without running tests
# - cleanup removes ONLY the run dir it created (marker + path prefix checked)
# Usage: PG_BIN=/path/to/pg/bin EXPECT_VERSION=17.6 EVIDENCE_DIR=/path \
#        scripts/db-tests/f1_isolated_run.sh [function.sql]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PG_BIN:?set PG_BIN to the PostgreSQL bin dir}"
EXPECT_VERSION=${EXPECT_VERSION:-17.6}
EVIDENCE_DIR=${EVIDENCE_DIR:-/tmp}
FUNC=${1:-supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql}
export PATH="$PG_BIN:$PATH"
RUN_DIR=$(mktemp -d /tmp/f1run-XXXXXXXX)
RUN_ID=$(basename "$RUN_DIR")
echo "$RUN_ID $$ $(date -Iseconds)" > "$RUN_DIR/.f1run-marker"
mkdir -m 0700 "$RUN_DIR/sock"
PORT=$((50000 + RANDOM % 10000))
LOG="$EVIDENCE_DIR/f1_${RUN_ID}.log"
started=0
cleanup() {
  set +e
  if [[ $started == 1 ]]; then pg_ctl -D "$RUN_DIR/data" -m fast -w stop >>"$LOG" 2>&1; fi
  [[ -f "$RUN_DIR/data/log/server.log" ]] && cp "$RUN_DIR/data/log/server.log" "$EVIDENCE_DIR/f1_${RUN_ID}_server.log"
  if [[ "$RUN_DIR" == /tmp/f1run-* && -f "$RUN_DIR/.f1run-marker" ]] && grep -q "^$RUN_ID $$ " "$RUN_DIR/.f1run-marker"; then
    rm -rf -- "$RUN_DIR" && echo "cleanup: removed $RUN_DIR (created by this run)" | tee -a "$LOG"
  else
    echo "cleanup: NOT removing $RUN_DIR (marker mismatch)" | tee -a "$LOG"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
exec > >(tee -a "$LOG") 2>&1
echo "run=$RUN_ID port=$PORT pg_bin=$PG_BIN func=$FUNC func_sha256=$(sha256sum "$FUNC" | cut -d" " -f1) head=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)"
[[ -e "$RUN_DIR/sock/.s.PGSQL.$PORT" ]] && { echo "BLOCKED: socket already exists"; exit 3; }
initdb -D "$RUN_DIR/data" -U postgres --auth-local=peer --auth-host=reject -E UTF8 --locale=C >/dev/null
OS_USER=$(id -un)
printf 'run %s postgres\nrun %s tester\n' "$OS_USER" "$OS_USER" > "$RUN_DIR/data/pg_ident.conf"
printf 'local all all peer map=run\n' > "$RUN_DIR/data/pg_hba.conf"
cat >> "$RUN_DIR/data/postgresql.conf" <<CONF
listen_addresses = ''
port = $PORT
unix_socket_directories = '$RUN_DIR/sock'
unix_socket_permissions = 0700
logging_collector = on
log_directory = 'log'
log_filename = 'server.log'
fsync = off
CONF
pg_ctl -D "$RUN_DIR/data" -w -t 60 start >/dev/null
started=1
export PGHOST="$RUN_DIR/sock" PGPORT=$PORT
INFO=$(psql -qXAt -U postgres -d postgres -c "select current_setting('server_version')||'|'||current_setting('listen_addresses')||'|'||current_setting('unix_socket_directories')||'|'||current_setting('data_directory')||'|'||coalesce(inet_server_addr()::text,'socket')")
echo "endpoint: $INFO"
IFS='|' read -r v la sd dd addr <<<"$INFO"
if [[ "$v" != "$EXPECT_VERSION" || -n "$la" || "$sd" != "$RUN_DIR/sock" || "$dd" != "$RUN_DIR/data" || "$addr" != socket ]]; then
  echo "BLOCKED: unexpected endpoint/config"; exit 3
fi
if command -v ss >/dev/null && ss -ltnH | awk '{print $4}' | grep -q ":$PORT\$"; then
  echo "BLOCKED: TCP listener on port $PORT"; exit 3
fi
echo "== pr140_run.sh"
rc1=0; scripts/db-tests/pr140_run.sh "$FUNC" || rc1=$?
echo "pr140_run.sh exit=$rc1"
echo "== f1_extra.sql"
rc2=0
DB=f1x_$$
psql -qX -U postgres -d postgres -c "create database $DB" >/dev/null
for r in anon authenticated service_role tester; do psql -qX -U postgres -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true; done
P() { psql -qX -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }
{ P -f scripts/db-tests/pr140_stub.sql && P -f supabase/migrations/20260930192406_p1_ai_rate_limit.sql \
  && P -f supabase/migrations/20260930192446_p1_security_definer_execute_hardening.sql && P -f "$FUNC" \
  && P -At -f scripts/db-tests/f1_extra.sql; } | grep -v '^$' || rc2=$?
echo "f1_extra.sql exit=$rc2"
echo "== parallel bypass burst (20 sessions, ever larger p_now_ms)"
U=11111111-1111-1111-1111-111111111111
P -c "select t.reset('$U')" >/dev/null
pids=()
for i in $(seq 1 20); do
  psql -qXAt -U postgres -d "$DB" -c "set role authenticated; set request.jwt.claim.sub='$U'; select allowed from public.consume_ai_rate_limit('$U', $((9000000000000 + i * 4000000)))" > "$RUN_DIR/b_$i" &
  pids+=($!)
done
wait "${pids[@]}"  # only the burst sessions (a bare `wait` also waits for the tee process substitution)
n=$(cat "$RUN_DIR"/b_* | grep -c '^t$' || true)
c=$(P -At -c "select cardinality(minute_stamps) from public.ai_rate_limits where user_id='$U'")
echo "bypass-burst: allowed=$n stored=$c (expected <=8 / <=8)"
rc3=0; [[ $n -le 8 && $c -le 8 ]] || rc3=1
psql -qX -U postgres -d postgres -c "drop database $DB" >/dev/null
echo "== RESULT pr140=$rc1 extra=$rc2 bypass_burst=$rc3"
[[ $rc1 == 0 && $rc2 == 0 && $rc3 == 0 ]]
