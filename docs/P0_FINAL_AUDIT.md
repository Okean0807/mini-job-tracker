# MiniJob Kompagnon — P0 Final Audit

Date: 2026-09-30
Scope: legal engine, income calculation, sickness/pay continuation, import boundary, cross-engine consistency, repository security.

## Status legend

- **FIXED** — addressed in the current working tree and covered by code/tests where practical.
- **NEEDS VERIFICATION** — implementation exists, but the environment does not permit a complete runtime/CI verification.
- **OPEN / HUMAN ACTION** — cannot be closed from this working environment.

## P0 checklist

| P0 item | Status | Evidence / limitation |
|---|---|---|
| Employment classification (Minijob / Hauptbeschäftigung / kurzfristig / selbstständig) | FIXED | `legal/employment.ts`; eligibility is centralized in the legal engine. |
| Multiple Minijobs use a shared income limit | FIXED | `limits.ts`; eligible Minijob shifts are aggregated before limit comparison. |
| Different hourly rates do not create a false common hour limit | FIXED | Multiple rates return no synthetic shared hourly limit. |
| 2026 default minimum wage / limit model | FIXED | `DEFAULT_SETTINGS` uses €13.90 and €603; legal rule lookup is date-based. |
| Actual vs future income | FIXED | `legal/integration.ts` and `limits.ts` separate `actual`, `expectedAdditional`, and `projectedEarnings`. |
| Rolling 12-month income model | FIXED | `legal/rolling.ts` is used by the legal assessment adapter. |
| Unpredictable exceedance model | FIXED | Existing legal engine models the separate exceptional-month path; UI warning does not automatically declare an exceedance lawful. |
| Sickness case identification | FIXED | Explicit `sickCaseId`; date proximity is no longer used as an automatic same-illness heuristic. |
| Entgeltfortzahlung / sickness payroll linkage | FIXED | Sick-case start is derived from the explicit case ID; payroll handles paid absence. |
| Vacation pay basis excludes overtime | FIXED | Vacation-pay calculation uses the 13-week reference logic and excludes overtime entries from the reference set. |
| XLS/XLSX untrusted client import | FIXED | Client import rejects `.xls/.xlsx`; no `XLSX.read()` in import path. |
| Import size boundary | FIXED | All client file imports, including JSON backup, are capped at 2 MiB before parsing. |
| Cross-engine consistency | FIXED | Dashboard, Statistics, Notifications and Annual Report use the legal `LimitUsage` source for legal-limit figures. |
| Historical leaked `.env` blob | OPEN / HUMAN ACTION | Historical blob remains reachable; key rotation must be performed in Supabase/cloud UI. |
| GitHub secret scanning | OPEN / PLATFORM LIMITATION | Previous API attempt reported scanning unavailable for this repository. |
| SheetJS dependency alerts | NEEDS VERIFICATION | Import attack surface is removed, but `xlsx@0.18.5` remains for generated exports. No blind upgrade was made. |
| Full Vitest / production build | NEEDS VERIFICATION | Uploaded snapshot has no installed dependencies; package-manager installation timed out. |

## Important findings from the final pass

### 1. JSON import size bypass — fixed in this phase

The previous 2 MiB check was below the JSON branch, so a JSON backup could bypass the common file-size boundary. The check is now performed before format dispatch.

### 2. Regression test defect — fixed in this phase

The future-income regression test had malformed helper arguments. The test now supplies the explicit Minijob job ID and dates correctly.

### 3. XLSX boundary

The application no longer accepts user-supplied XLS/XLSX workbooks through the client import dialog. XLSX remains an export format. This is a security boundary, not a claim that the underlying `xlsx@0.18.5` dependency is vulnerability-free.

### 4. Runtime verification

A complete dependency-backed test/build run remains outstanding. No claim of a green CI or production build is made from this environment.

## P0 conclusion

The **application/legal-engine P0 implementation is substantially hardened**, but the project as a whole should **not be marked P0-closed yet** because two external/security items remain: historical secret rotation and verification of the remaining SheetJS dependency, plus a missing full CI/runtime run.

The next work should therefore be:

1. keep the current legal engine as the single source of truth;
2. obtain a dependency-backed CI run and fix any actual compile/test failures;
3. complete human key rotation and re-verify repository hygiene;
4. decide on a maintained XLSX export strategy after regression testing;
5. only then move to P1.
