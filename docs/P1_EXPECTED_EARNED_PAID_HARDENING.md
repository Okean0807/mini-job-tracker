# P1 — Expected / Earned / Paid Hardening

## Ziel

Die bisherige Payday-Logik verwendete `expected` gleichzeitig als berechnetes Entgelt aus allen erfassten Schichten. Damit waren geplante zukünftige Einträge nicht sauber von bereits verdientem Entgelt und tatsächlich erhaltenen Zahlungen getrennt.

Die neue Semantik trennt drei Ebenen:

- **expected** — gesamtes für den Abrechnungsmonat berechnetes Entgelt, einschließlich noch zukünftiger geplanter Einträge;
- **earned** — bis zum Stichtag bereits angefallenes Entgelt;
- **paid** — tatsächlich erfasste Zahlung (`Payment.actual`).

Zusätzlich:

- **outstanding** = `max(0, expected - paid)`;
- **paymentDiff** = `paid - earned`;
- **overdue** wird nur dann gesetzt, wenn der Zahltag vor dem Stichtag liegt und die tatsächliche Zahlung das bis dahin verdiente Entgelt nicht deckt.

## Warum die Trennung wichtig ist

Beispiel:

```text
Verdient bis 15.03.       150 €
Geplant für den Monat     225 €
Bereits ausgezahlt        100 €
```

Das ist nicht dasselbe wie:

```text
Erwartet: 225 €
Ausgezahlt: 100 €
```

Die erste Darstellung beantwortet zusätzlich die Frage, was bereits tatsächlich verdient wurde.

## Stichtag

`payPeriod()` akzeptiert optional `asOfDate` (ISO-Datum). Standardmäßig wird das lokale aktuelle Datum verwendet.

Damit werden zukünftige Schichten nicht als bereits verdient ausgewiesen.

## Rückwärtskompatibilität

Das bisherige Feld `diff` bleibt erhalten und bedeutet weiterhin:

```text
payment.actual - expected
```

Neue Verbraucher sollen stattdessen die expliziten Felder `earned`, `paid`, `outstanding` und `paymentDiff` verwenden.

## Überfälligkeit

`overdue` basiert bewusst auf `earned`, nicht auf `expected`.

Dadurch wird eine Zahlung nicht allein deshalb als überfällig markiert, weil später im Monat noch geplante Schichten existieren.

## Noch offen

Die Datenstruktur `Payment` enthält weiterhin genau eine erfasste Zahlung pro Job/Monat. Mehrere Teilzahlungen innerhalb eines Abrechnungsmonats sind damit noch nicht modelliert. Das ist ein separater Ausbau und wurde in dieser Phase bewusst nicht eingeführt.
