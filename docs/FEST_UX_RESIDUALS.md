# FEST UX – Residuals (nicht in diesem PR)

## frei / sonstige
Neue `ShiftKind`-Werte `frei` und `sonstige` wurden **nicht** eingeführt.
Grund: sichere Integration würde `ShiftKind`, Payload-Validierung (`payload.ts`), i18n-Labels,
Kalenderfarben, Payroll/Fortzahlung und Export betreffen. Ohne diese Kette wäre der Eintrag unsicher.
Bestehende Arten bleiben: `arbeit` | `urlaub` | `krank` | `feiertag`.
Urlaub/Krank neu: From–To über `AbsenceDialog` (vom ShiftDialog umgeleitet).

## Entgeltfortzahlung
Feiertage nutzen weiterhin `isHoliday`. Es wird **kein** neues EFZ-Recht erfunden;
Arbeitszeitkonto zählt Plan-Soll und erfasste Ist-Arbeit getrennt von Lohnregeln.
