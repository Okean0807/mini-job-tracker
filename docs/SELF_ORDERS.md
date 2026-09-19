# Selbstständig: Aufträge (minimal)

## Modell
Neue Entität `Order` in `AppData.orders` — **nicht** `Job.rate` oder `Project` überladen.
Vereinbarter Preis (`amount`) und Kennzahl **Umsatz pro Arbeitsstunde** (`amount / hoursWorked`) sind kein Stundenlohn.

## UX
Nur wenn `primaryWorkMode === "selbststaendig"`: Dashboard-Karte „Aufträge“ (+ optional Abschnitt auf `/jobs`).
FLEX/FEST unverändert (kein Arbeitszeitkonto-/Minijob-Limit-Bezug).

## Einnahme-Zuordnung (Residual)
`paymentId` ist ein optionaler Hook. Die UI erlaubt Auswahl/Leeren einer bestehenden `Payment`-Zeile.
Payments bleiben job-/payday-bezogen — **keine** vollständige Auftrags-Einnahmen-/Rechnungs-UX in diesem Schritt.
