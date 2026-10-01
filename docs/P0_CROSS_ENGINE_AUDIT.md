# P0 Cross-Engine Audit

## Scope

The legal Minijob income calculation must not diverge between Dashboard, Statistics, Notifications and Annual Report.

## Result

The following surfaces now use the same `LimitUsage` legal source for limit-share calculations:

- Dashboard: `monthUsage()` / `yearUsage()`
- Statistics annual limit card: `yearUsage()`
- Notifications: `monthUsage()` / `yearUsage()`
- Annual report: `yearUsage()`

`legal/integration.ts` remains the underlying adapter that separates actual and future income and filters legally eligible Minijob shifts.

## Deliberate separation

General payroll statistics may include non-Minijob employment because they describe total recorded work. They must not be reused as the legal Minijob income figure.

The legal figure is therefore derived from the legal engine, not from generic `payrollTotals()` output.

## Remaining limitation

A full Vitest run has not been verified in this environment because the uploaded project snapshot does not contain installed dependencies and the available package-manager installation attempt timed out. The added cross-engine tests are included for the project CI environment.
