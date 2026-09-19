# FEST UX – Residuals

## frei / sonstige
Umgesetzt in v1.1 Hardening: `ShiftKind` enthält `frei` | `sonstige`.
- AbsenceDialog + `isAbsenceKind`
- Payroll: expliziter Unpaid-Zweig vor Urlaub-Fallback (`earnings 0`, `paid false`)
- Kalender: neutrales Grau
- Arbeitszeitkonto: kein Ist (nur `arbeit`); Soll bleibt Plan-Soll; Arbeitstage ohne frei/sonstige

## Payday / Monatsbrutto
`payPeriod.expected` nutzt weiterhin die Schicht-Payroll-Summe (`payrollTotals`), **nicht**
direkt `job.monthlyGross`. Residual: für FEST monthly ohne vollständige Monatserfassung
weicht die Payday-Erwartung vom Monatsbrutto ab. Ableitung Stundenlohn aus Monatsbrutto
(`effectiveHourlyFromMonthly`) gilt für Schicht-/Abwesenheitslohn.

## Entgeltfortzahlung
Feiertage nutzen weiterhin `isHoliday`. Es wird **kein** neues EFZ-Recht erfunden;
Arbeitszeitkonto zählt Plan-Soll und erfasste Ist-Arbeit getrennt von Lohnregeln.
