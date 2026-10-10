#!/usr/bin/env bash
# Resolve range and run gitleaks (redacted, non-zero exit on findings).
# GITLEAKS: path to gitleaks binary (default ./gitleaks). Runs in the current repo.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
opts="$("$here/gitleaks-range.sh")"
echo "Scanning log range: $opts"
"${GITLEAKS:-./gitleaks}" git --no-banner --redact --verbose --exit-code 1 --log-opts="$opts" .
