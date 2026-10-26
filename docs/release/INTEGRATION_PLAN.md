# Release-Integration v1.0 – Plan (Entwurf, nichts ausgeführt)

Stand 2026-10-26. Kein Merge, Rebase, Push oder Migrations-Apply durch diesen Plan.
Jeder Schritt mit Wirkung auf GitHub/Production braucht eine eigene Freigabe.

## 1. Branches (verifiziert per `git merge-base` / `git rev-list` / `git merge-tree`)

| | `main` | `release/v1.0-integration` (PR #146, Draft) | `claude/minijob-companion-release-prep-vj0t72` |
|---|---|---|---|
| HEAD | `4bbab7a` | `8595241` | lokal `6e5cd33` (remote `7a0a747`) |
| gemeinsamer Vorfahre | – | `4bbab7a` | `4bbab7a` |
| Commits über `main` | 0 | 63 (u. a. PRs #140–#145, R3–R6) | 22 |
| `main` voraus | – | 0 | 0 |
| Probe-Merge Release-Prep ⇄ Integration | | 8 Dateien mit Textkonflikt | |

Konfliktdateien (`git merge-tree --write-tree`): `TodayImportantCard.tsx`,
`ai.functions.ts`, `ai/gemini-provider.ts`, `i18n/dict/v2.ts`,
`minijob/ai-context.ts`, `minijob/store.ts`,
`security/supabase-migrations-guard.test.ts`, `routes/einstellungen.tsx`.

## 2. Migrationen

Production (`jauzsejxdfpnlgdtohuv`, read-only geprüft 2026-10-26): neueste
angewendete Version `20260930192515`; F-1 nicht aktiv (Fenster über `p_now_ms`),
C-1 nicht aktiv (INSERT/UPDATE-Policies vorhanden), RLS `ai_rate_limits` aus.

| Änderung | Datei / Version | `main` | Integration | Release-Prep | Production |
|---|---|---|---|---|---|
| F-1 Serveruhr | `migrations/20261014100000_p2_ai_rate_limit_server_clock.sql` (sha256 `f6ea5969…`) | – | ja | ja (byte-identisch) | nicht angewendet |
| C-1 keine direkte Client-Schreibung `documents` | `20261012160000_p2_documents_no_direct_client_write.sql` | `pending/` | `migrations/` | `pending/` | nicht angewendet |
| RLS `ai_rate_limits` | `pending/20260930220000_p1_ai_rate_limit_rls.sql` | `pending/` | `pending/` | `pending/` | nicht angewendet |

Folgen eines Merges nach `main` (GitHub-Integration „Deploy to production" für
`main`, laut `supabase-migrations-guard.test.ts`):

- **Integration**: wendet C-1 (`20261012160000`) und danach F-1 (`20261014100000`)
  an – Reihenfolge korrekt, beide neuer als `20260930192515`.
- **Release-Prep allein**: wendet nur F-1 an; C-1 bleibt pending. Ein späterer
  Merge der Integration brächte C-1 mit einer **älteren** Version als das bereits
  angewendete F-1 → Out-of-order-Migration (Risiko).
- **RLS** (`20260930220000`) ist in keinem Branch in der Kette und älter als die
  neueste Production-Version → beim Verschieben neu nummerieren (> `20261014100000`).
- Keine doppelten Versionsnummern; F-1 ist in beiden Branches identisch.
  Abhängigkeit: F-1 ersetzt die Funktion aus `20260930192406`; Grants aus
  `20260930192446` bleiben gleich.

## 3. Commit-Abgleich Release-Prep → Integration

| Release-Prep | Inhalt | In Integration? | Vorgehen |
|---|---|---|---|
| `f499f97` | KI: eine Server-Deadline für Rate-Limit-RPC + Provider; Gemini-3-Thinking begrenzt | **nein** (Deadline dort nach dem RPC, kein `thinkingConfig`) | portieren; Privacy-Gate der Integration bleibt **vor** dem RPC |
| `1b48f9b` | Build-Guard Preview-Isolation | nein | übernehmen (konfliktfrei) |
| `f845484` | OAuth-redirectTo-Tests | nein | übernehmen |
| `4f8ac1f` `624cad5` `02bde8a` `6a61cac` | sicheres KI-Markdown; Forecast-Block/Regeln, keine Schätzung aus 1 Tag, kein LaTeX | nein | Markdown übernehmen; Forecast auf die O4-/`minijobEarnings`-Basis der Integration portieren |
| `0f5f03e` `e97146e` | Import: alle Tabellenformate abweisen, Tests | nein | übernehmen |
| `ad1dbaf` | KI-Kontext nur Minijobs | **ersetzt** durch `30e0482` `113748b` `cc1c1a3` `b05e85a` (DECISIONS R3) | verwerfen |
| `72a8c50` | (A) Multi-Minijob-Hinweis, (B) Stunden je Minijob in Einstellungen, (C) Standardsatz nach Datum, (D) vorsichtiger Grenz-Text | (A) **ersetzt** durch O4 (`0a0adf5` `461fe3d` `1a87a21` `4e4b64c`); (C) **ersetzt** durch `7a20098`; (B) und (D) nein | nur (B) und (D) portieren, gegen O4-Texte/LimitCard der Integration prüfen |
| `127d2d2` | `minijobStatus` im KI-Kontext | **ersetzt** durch O4 im KI-Kontext | verwerfen |
| `744fd30` `7a0a747` `256a02b` | CI auf allen Branches, bun 1.3.14, Tree-Scan | nein (Integration: `tsc` + XLSX-Guard nur für main/PR) | übernehmen; doppelten `tsc`-Schritt vermeiden (Schritte der Integration behalten) |
| `7324045` | Upload-Test in node-Umgebung | nein | übernehmen |
| `5c7e16a` | ai-guard: `payload_too_large` statt „Ungültige Anfrage" | nein | übernehmen |
| `8ce82a6` | Lint-Fix Regex | nein | übernehmen |
| `743864c` | F-1 in die Kette | **identisch** vorhanden | verwerfen (Guard/README der Integration behalten) |
| `c6ed1ca` | Pending-README: Reihenfolge/Evidenz | teilweise | an Integrationsstand (C-1 in Kette) anpassen |
| `2242264` | Spec Multi-Minijob A/B/C | O4 bereits entschieden | als „überholt durch O4" markieren oder verwerfen |
| `6e5cd33` | DB-Test-Wrapper mit RLS-Assertion, README | nein | übernehmen (neue Dateien) |

## 4. Varianten

| | A: Release-Prep weiter | B: Integration weiter | C: neue Branch ab Integration + nötige Commits |
|---|---|---|---|
| Migrationsrisiko | hoch: nur F-1, C-1 später out-of-order | niedrig: C-1 + F-1 geordnet | niedrig (wie B) |
| Verlust von Fixes | hoch: 63 Commits der Integration fehlen (O4, Krankheit, SheetJS 0.20.3, Privacy-Gate, Legal-Guard …) | hoch: 13 eigenständige Fixes dieser Branch fehlen | gering, wenn Tabelle 3 abgearbeitet ist |
| Konflikte | 8 Dateien + semantische Doppelungen | keine | 8 Dateien, aber gezielt pro Commit |
| Rollback | unübersichtlich | gut (ein Merge-Commit) | gut (ein Merge-Commit, kleine Commits) |

**Empfehlung: C.** Neue Branch ab `release/v1.0-integration` (`8595241`),
Release-Prep-Commits laut Tabelle 3 einzeln per `cherry-pick` bzw. manueller
Portierung; danach Ziel-Branch von PR #146 aktualisieren oder neuen PR gegen
`main` öffnen. Die Integration bleibt die fachliche Basis (Owner-Entscheidungen R3–R6).

Reihenfolge-Vorschlag: konfliktfrei zuerst (`1b48f9b`, `f845484`, `0f5f03e`,
`e97146e`, `7324045`, `5c7e16a`, `8ce82a6`, `6e5cd33`), dann CI (`744fd30`,
`7a0a747`, `256a02b`), dann manuell `f499f97`, Markdown/Forecast, `72a8c50` (B, D).

## 5. CI und Schutzprüfungen nach der Zusammenführung

- `vitest.yml`: Trigger aus Release-Prep (push auf alle Branches, Job-`if` gegen
  doppelte Runs bei PRs aus dem eigenen Repo), bun 1.3.14; Schritte der Integration
  (`TypeScript` und `XLSX boundary guard` mit `if: !cancelled()`) behalten, eigenen
  `Typecheck`-Schritt entfernen.
- `supabase-migrations-guard.test.ts`: Fassung der Integration (11 Dateien, C-1 + F-1,
  F-1-Hash identisch).
- Secret-Scan-Bereiche (`gitleaks-range.sh`, Self-Test 18/18):
  - push auf Branch: `before..after`; neue Branch / Force-Push: gesamte Historie des Tips;
  - PR: `merge-base(base, head)..head`;
  - Merge-Commit nach `main` (push): `before..after` enthält alle gemergten Commits;
    Squash-Merge: der neue Commit mit vollem Diff;
  - „Update branch" (main in PR-Branch gemergt): `before..after` inkl. bereits auf
    main gescannter Commits – redundant, aber vollständig;
  - zusätzlich Tree-Scan auf jedem Event (deckt „evil merge" ab).

## 6. Offene Risiken

1. Merge nach `main` wendet C-1 und F-1 sofort in Production an (Freigabe nötig).
2. Isolierte DB-Tests liefen lokal mit PostgreSQL 16.15, Autor-Lauf mit 17.6.
3. Ob ein Push Supabase-Branching auslöst, ist aus der API nicht sicher erkennbar
   (nur `main`-Branch vorhanden, frühere Pushes erzeugten keine Preview-DBs).
4. Semantische Konflikte (O4 vs. eigener Hinweis, Forecast-Basis) erfordern Review,
   nicht nur Konfliktauflösung.
5. Impressum/Datenschutz weiter ohne Betreiberangaben.
