# Versionierte Rechtsregeln (Legal-Rules-Layer)

## Wo die Regeln liegen

- `src/lib/minijob/legal/rules.ts` – reine Datenschicht: Liste aller
  `LegalRuleVersion`-Einträge (Mindestlohn, Rentenversicherung, steuerlicher
  Rahmen) mit `effectiveFrom` / `effectiveUntil`.
- `src/lib/minijob/legal/index.ts` – Auflösung nach Stichtag und Ableitungen
  (`ruleVersionFor`, `minimumWageFor`, `minijobIncomeLimitFor`,
  `minijobYearlyLimitFor`, `monthlyHoursLimitFor`, `pensionRulesFor`,
  `taxRulesFor`, `legalContextFor`).
- `src/lib/minijob/legal/legal.test.ts` – fokussierte Tests.

Die Schicht ist UI-unabhängig und hat keine Abhängigkeit zur bestehenden
Lohnberechnung. Die vorhandene Engine (`calc.ts`, `rate.ts`, `limits.ts`,
`service.ts`) wurde nicht verändert; die Rangfolge Schicht → Job → Standard
sowie `Customer.rate` / `Project.rate` bleiben unberührt.

## Wie Stichtage aufgelöst werden

`findRuleVersion(date)` wählt die Version, deren `effectiveFrom <= Datum` ist und
deren `effectiveUntil` (falls gesetzt) `>= Datum` ist; bei mehreren Treffern die
mit dem spätesten `effectiveFrom`. Liegt das Datum vor der ältesten Version,
wird `undefined` zurückgegeben (`ruleVersionFor` wirft) – neue Regeln wirken
damit nie rückwirkend.

## Aktuell abgebildete Regeln

| Version | Gültig ab  | Mindestlohn | Minijob-Grenze/Monat | Jahresgrenze |
| ------- | ---------- | ----------- | -------------------- | ------------ |
| de-2024 | 01.01.2024 | 12,41 €     | 538 €                | 6.456 €      |
| de-2025 | 01.01.2025 | 12,82 €     | 556 €                | 6.672 €      |
| de-2026 | 01.01.2026 | 13,90 €     | 603 €                | 7.236 €      |
| de-2027 | 01.01.2027 | 14,60 €     | 633 €                | 7.596 €      |

Die Monatsgrenze wird nicht doppelt hart kodiert, sondern nach § 8 Abs. 1a SGB IV
abgeleitet: `Mindestlohn × 130 ÷ 3`, aufgerundet auf volle Euro.

Rentenversicherung (geltendes Recht, über alle Versionen identisch):
versicherungspflichtig, Befreiung auf Antrag möglich, Arbeitnehmeranteil 3,6 %,
Arbeitgeber-Pauschalbeitrag 15 %.

Steuer: nur die vom Arbeitgeber getragene einheitliche Pauschsteuer von 2 %
(§ 40a Abs. 2 EStG) als Parameter. Eine Arbeitnehmer-Lohnsteuerberechnung ist
bewusst nicht implementiert (`employeeIncomeTax: "not-implemented"`).

## Bewusst NICHT implementiert

- geplante/diskutierte Minijob- und Rentenreformen ohne Gesetzeskraft,
- spekulative künftige Beitragssätze,
- individuelle Lohnsteuer-, Kranken- und Pflegeversicherungsberechnung,
- Midijob-Übergangsbereich (Gleitzone).

## Neue Rechtsänderung ergänzen

1. In `LEGAL_RULE_VERSIONS` einen neuen Eintrag mit `effectiveFrom` (und ggf.
   `effectiveUntil` der Vorgängerversion) anlegen.
2. Nur belegbare Werte eintragen und `source` setzen.
3. Test in `legal.test.ts` für Stichtag und abgeleitete Grenze ergänzen.

Die Berechnungs-Engine muss dafür nicht angefasst werden.

## Anbindung an das Limit-System (Stand: 2026-08)

Die Rechtsschicht ist jetzt produktiv mit `src/lib/minijob/limits.ts` verbunden:

- `monthlyLimitOf(settings, year, month)` löst die Geringfügigkeitsgrenze **stichtagsbezogen**
  aus `legal/` auf (Mindestlohn × 130 ÷ 3, aufgerundet).
- `yearlyLimitOf(settings, year)` summiert die zwölf Monatsgrenzen, damit unterjährige
  Rechtsänderungen korrekt abgebildet werden.
- `monthlyHoursLimit` / `yearlyHoursLimitOf` leiten die Stundengrenze aus der Grenze des
  jeweiligen Zeitraums ab.
- Fehlt für ein Datum eine Regelversion (vor 2024), gilt der in den Einstellungen
  gespeicherte Wert; `LimitUsage.limitSource` meldet dann `"manual"`.
- Neue Einstellung `Settings.limitAuto` (Standard `true`). Bestandsdaten werden in
  `store.normalize` nur dann auf `true` migriert, wenn die gespeicherte Monatsgrenze einem
  bekannten gesetzlichen Wert entspricht; individuell gesetzte Grenzen bleiben manuell.

Tests: `src/lib/minijob/limits.test.ts`.

## Payroll-Semantik: Urlaub, Krankheit, Feiertag

Implementiert in `src/lib/minijob/payroll.ts`. Grundsatz: bezahlte Abwesenheit
erzeugt **Entgelt**, aber **keine geleisteten Arbeitsstunden** – damit ist eine
Doppelzählung in Stunden- und Einkommensgrenzen ausgeschlossen.

| Fall | Regel | Ergebnis |
| --- | --- | --- |
| Feiertag (§ 2 EntgFG) | nur bezahlt, wenn der Tag nach Festplan/Muster ein Arbeitstag ist | `holiday-pay` / `holiday-off-day` |
| Krankheit (§ 3 EntgFG) | Wartezeit 4 Wochen ab `job.startDate`, danach bis 6 Wochen je Fall (Lücke ≤ 7 Tage = ein Fall) | `sick-waiting` / `sick-pay` / `sick-exceeded` |
| Urlaub (§ 11 BUrlG) | Tagesentgelt = Durchschnitt der letzten 13 Wochen (mind. 5 Referenztage), sonst Plan-Fallback (`estimated: true`) | `vacation-pay` |
| Entgeltausfallprinzip (§ 4 EntgFG) | fortgezahlt wird die regelmäßige Arbeitszeit ohne Zuschläge für nicht geleistete Arbeit | `basis: plan / average13 / entry` |

Konsumenten: `limits.ts` (Monats-/Jahresgrenze), `service.ts` (Statistiken),
`payday.ts` (erwartete Auszahlung = Arbeitsentgelt + Entgeltfortzahlung) und
`insights.ts` (Monatsstunden = geleistete Arbeit, Ø-Satz aus Arbeitsentgelt).

Die Entgeltfortzahlung zählt als Arbeitsentgelt i. S. d. § 14 SGB IV und damit
zur stichtagsbezogenen Geringfügigkeitsgrenze (siehe Legal-Rules oben).
