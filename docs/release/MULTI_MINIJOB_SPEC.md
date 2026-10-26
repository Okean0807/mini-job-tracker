# Spec: Hauptbeschäftigung + mehrere Minijobs (Entwurf, NICHT umgesetzt)

Status: zur Entscheidung durch die Projektleitung. Kein Code, keine Schema- oder
UI-Änderung, bis eine Variante freigegeben ist. Stand des Codes: Release-Branch
`claude/minijob-companion-release-prep-vj0t72`.

## 1. Rechtlicher Ausgangspunkt (zu verifizieren)

Nach § 8 Abs. 2 SGB IV und den Auskünften der Minijob-Zentrale bleibt neben einer
versicherungspflichtigen Hauptbeschäftigung nur **ein** Minijob geringfügig – der
**zeitlich zuerst aufgenommene**. Jeder weitere Minijob wird mit der
Hauptbeschäftigung zusammengerechnet (versicherungspflichtig außer
Arbeitslosenversicherung), auch wenn die Summe der Minijobs unter der Grenze liegt.
Ohne Hauptbeschäftigung werden alle Minijobs zusammengerechnet.
Nicht modelliert: ruhende Hauptbeschäftigung (z. B. Elternzeit), kurzfristige
Beschäftigungen, Übergangsbereich. Volltext von § 8 SGB IV vor Umsetzung prüfen.

## 2. Ist-Zustand

| Baustein | Verhalten |
|---|---|
| `limits.monthUsage` / `yearUsage` | summieren **alle** eligible Minijobs (`isEligibleMinijobShift`), HB ausgeschlossen |
| `legal/employment.multipleMinijobsBesideMainJob(jobs, date)` | `none` / `order_known {firstJobId, furtherJobIds}` / `order_unknown {jobIds}` |
| Dashboard „Heute wichtig" | vorsichtiger Hinweis (bekannt/offen), keine Rechtsfolge |
| KI-Kontext | `minijobStatus` + Regeln (nicht behaupten, alle bleiben Minijobs) |

Datenmodell: `Job.employmentType`, `Job.startDate?`, `Job.endDate?`, `Job.archived?`.
`startDate` ist optional; Altbestände haben oft keines.

## 3. Bestimmung des ersten Minijobs (gemeinsam für B und C)

Stichtag `D` (Monatsbetrachtung: jeder Kalendertag, praktisch der Schicht-Tag):

1. Aktive HB an `D`: `employmentTypeOf(job) === "hauptbeschaeftigung"`, nicht
   archiviert, `jobActiveOn(job, D)`. Keine → Regeln aus Abschnitt 6.
2. Kandidaten: aktive Minijobs an `D` (gleiche Filter, `isMinijobEmployment`).
3. Erster = Minimum von `startDate`. Beendete Minijobs (`endDate < D`) zählen nicht;
   endet der erste, rückt der nächstältere nach (Annahme, **rechtlich bestätigen**).
4. Uneindeutig (`order_unknown`), wenn ein Kandidat kein `startDate` hat oder das
   früheste Datum mehrfach vorkommt.

Offen: Zählt ein Minijob, der *vor* der HB begann, ebenfalls als „erster"? Laut
Quelle ja (Reihenfolge der Minijobs), bitte bestätigen.

## 4. Varianten

### A – Status quo (nur Hinweis)
- Berechnung unverändert (alle Minijobs gegen eine Grenze).
- Folge: Bei HB + mehreren Minijobs ist die angezeigte Minijob-Summe zu hoch
  (enthält versicherungspflichtige weitere Minijobs); Ampel/Prognose können zu
  früh warnen. Kein Datenmodell-/UI-Aufwand. Risiko: fachlich ungenau.

### B – Berechnung nach Beginndatum
- `monthUsage`/`yearUsage` (und Rolling/Prognose, Statistik, Benachrichtigungen,
  Jahresbericht) erhalten pro Tag die Rolle je Minijob: `counted` (erster) oder
  `beside_main` (weitere, voraussichtlich versicherungspflichtig).
- Grenze/Spielraum nur über `counted`; neue Felder z. B.
  `LimitUsage.besideMainEarnings`.
- Bei `order_unknown`: **Fallback = Variante A** (alle zählen) + Hinweis
  „Reihenfolge offen – Beginndaten eintragen" (konservativ: eher zu früh warnen
  als zu spät).
- Folge: zentrale Rechtslogik ändert sich; viele Aufrufer; neue Tests je Modul;
  Monatswechsel der Rolle (Ende des ersten Minijobs) muss tageweise stimmen.

### C – Beginndatum erzwingen + B
- Wie B, zusätzlich: Ist eine HB aktiv und gibt es ≥ 2 Minijobs, verlangt
  JobDialog ein `startDate` für jeden Minijob (Validierung + Hinweis an
  Altbestände, analog `jobsNeedingEmploymentType`).
- Folge: UI-/Validierungsänderung, keine Schemaänderung (Feld existiert);
  Bestandsnutzer müssen nachpflegen; danach entfällt der Fallback weitgehend.

## 5. Darstellung (B/C)

- Dashboard/LimitCard: „Minijob-Grenze" zeigt nur den gezählten Minijob;
  separate Zeile „Weitere Minijobs neben Hauptbeschäftigung: X € (voraussichtlich
  versicherungspflichtig)"; HB-Verdienst nur im Gesamtverdienst, nie in der Grenze.
- Statistik/Jahresbericht: drei Summen (gezählt / weitere Minijobs / andere
  Beschäftigungen).
- Hinweistext (5 Sprachen), nie als sichere Rechtsfolge: „voraussichtlich",
  „bitte mit Arbeitgeber oder Minijob-Zentrale prüfen".
- KI-Kontext: `minijobEarningsEntered` = nur gezählt; neu
  `besideMainMinijobEarnings`; Regeln bleiben vorsichtig.

## 6. Ohne Hauptbeschäftigung (alle Varianten)

Unverändert: alle aktiven Minijobs werden zusammengerechnet; kein Hinweis.
Regressionstests bestehen (`limits.test.ts` „aggregiert mehrere Minijobs",
`minijob-limit-scenarios.test.ts` 2)).

## 7. Testplan (B/C)

1. HB + 1 Minijob → unverändert.
2. HB + 2 Minijobs, Beginn eindeutig → nur erster in Grenze; weiterer separat.
3. HB + 2 Minijobs, ein `startDate` fehlt → Fallback alle + Hinweis „offen".
4. Gleiches früheste Datum → wie 3.
5. Erster Minijob endet mitten im Monat → Rolle wechselt ab Folgetag (nach
   rechtlicher Bestätigung).
6. HB endet → ab Folgetag alle Minijobs wieder zusammen.
7. Ohne HB, 3 Minijobs → Summe aller (Regression).
8. Jahres-/Rolling-Sicht und Prognose konsistent mit Monatswerten.
9. KI-Kontext-Felder und Hinweise je Fall.

## 8. Entscheidung benötigt

1. Variante A, B oder C.
2. Bestätigung der Annahmen in 3.3 (Nachrücken) und „vor HB begonnen".
3. Fallback bei offener Reihenfolge (Empfehlung: konservativ alle zählen).
4. Ob Hinweise auch in Exporten/Arbeitsnachweisen erscheinen sollen.
