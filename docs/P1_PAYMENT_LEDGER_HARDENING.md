# P1 Payment Ledger Hardening

## Ziel

`Payment[]` ist der Zahlungsledger pro `Job + Abrechnungsmonat`. Ein Monat kann mehrere bestätigte Teilzahlungen enthalten.

## Semantik

- `Expected`: vollständiges erwartetes Entgelt des Abrechnungsmonats, inklusive geplanter zukünftiger Schichten.
- `Earned`: bis `asOfDate` bereits angefallenes Entgelt.
- `Paid`: Summe aller bestätigten (`confirmed !== false`) Zahlungen dieses Jobs/Monats.
- `Open`: `max(0, Earned - Paid)`.
- `Overpaid`: `max(0, Paid - Earned)`.
- `Overdue`: `dueDate < asOfDate` und `Open > 0`.

Damit erzeugen zukünftige geplante Schichten keine offene Forderung.

## Migration

Es ist keine strukturelle Migration alter Zahlungsdaten erforderlich: Das bestehende Modell speichert bereits jede Zahlung als eigenes `Payment` mit eigener `id`. Die bisherige Ein-Zahlung-Ansicht wurde lediglich als Einzelzugriff (`findPayment`) behandelt. Bestehende Datensätze bleiben gültige Ledger-Einträge und werden standardmäßig als bestätigt behandelt.

## UI

- mehrere Zahlungen hinzufügen;
- einzelne Zahlung bearbeiten;
- einzelne Zahlung löschen;
- Summe `Paid` anzeigen;
- `Open` und `Overpaid` getrennt anzeigen;
- Zahlungsdifferenz auf Basis `Earned - Paid`.

## Cross-engine follow-up

- `Dashboard`: uses the same `PayPeriod` ledger and therefore already shows `Expected`, `Earned`, `Paid`, `Open`, `Overpaid` and `Overdue` per job/month.
- `Statistik`: now consumes `payPeriods()` for the selected month and year and explicitly shows `Expected`, `Earned`, `Paid` and `Open`; overdue count and overpaid amount are shown separately.
- `Jahresbericht`: remains earnings/work-time based by design. It does not reinterpret payroll receipts as earned income; therefore no payment-ledger mutation is required there.
- Work-report / Arbeitsnachweis exports remain shift/payroll based and are not converted into bank-payment exports. This keeps `earned` and `paid` semantically separate.
- `OrdersCard` / order payments remain a separate order-payment concept and are not mixed into payroll payments.
