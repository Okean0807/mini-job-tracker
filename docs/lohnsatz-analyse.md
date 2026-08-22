# Analyse: Lohnsatz-System (Stand: reine Inspektion, keine Verhaltensänderung)

Geltende Hierarchie (unverändert): **Schicht → Job → Standard**.

## 1. `Shift.rate = 0`

**Entstehung / Bearbeitung**

- `ShiftDialog.tsx` (Z. 125): Vorbelegung `shift?.rate ?? fallbackJob?.rate ?? settings.defaultRate` –
  ein bestehender Wert 0 wird also als 0 angezeigt (kein Fallback, da `??`).
- `ShiftDialog.tsx` (Z. 169, 205): gespeichert wird `Number(rate.replace(",", ".")) || 0`.
  Leeres oder unparsbares Feld ⇒ **0**. Das Feld ist nicht als „leer/unset“ darstellbar.
- `WorkTimer.tsx` (Z. 50): `activeJob?.rate ?? settings.defaultRate` – hier entsteht 0 nur,
  wenn der Job selbst 0 hat.
- `csv.ts` (Z. 151): `rate! || job?.rate || options.defaultRate` – beim Import fällt 0 **doch**
  auf Job- bzw. Standardsatz zurück. Das ist die einzige Stelle mit abweichender Semantik.

**Speicherung**: `store.ts` speichert `rate` unverändert; das Feld ist in `types.ts` `rate: number`
(nicht optional), es gibt also keinen technischen „unset“-Zustand.

**Verwendung**: `rate.ts#effectiveShiftRate` → `shift.rate || 0`; `calc.ts#shiftBreakdown` rechnet
damit Basislohn und prozentuale Zuschläge. Ergebnis: 0 €/h, keine Rückfallkette.

**Bewertung**: 0 ist heute faktisch **„nicht gesetzt“ (leeres Formularfeld)**, wird aber als
**intentionale Null** verrechnet. Eine Änderung (0 ⇒ Fallback auf Job/Standard) würde:

- Schichten betreffen, die aus einem leeren Lohnfeld heraus gespeichert wurden (Verdienst steigt),
- unbezahlte Einsätze unmöglich machen, sofern jemand 0 bewusst nutzt,
- den CSV-Import konsistent machen,
- Tests in `rate.test.ts` (Edge-Case „Schichtsatz 0“) berühren.

## 2. `Job.rate = 0`

| Ort | Unterscheidung unset / 0 |
| --- | --- |
| `types.ts` | `rate: number` – **kein** unset möglich |
| `JobDialog.tsx` Z. 65/89 | Vorbelegung `job?.rate ?? defaultRate`; Speichern `Number(...) || 0` ⇒ leeres Feld wird 0 |
| `store.ts` | keine Normalisierung, 0 wird persistiert |
| `rate.ts#resolveRate` | `job.rate > 0` ⇒ 0 gilt als **nicht gesetzt**, Fallback auf `settings.defaultRate` |
| `service.ts#rateForDate` | delegiert an `resolveRate`, gleiche Semantik |
| `calc.ts` | benutzt `job.rate` gar nicht, nur `shift.rate` |
| `ShiftDialog.tsx` Z. 125/259 | `?? `-Verkettung bzw. direkte Übernahme ⇒ Job-Satz 0 wird als 0 in die Schicht übernommen |
| `WorkTimer.tsx` Z. 50 | `??` ⇒ Job-Satz 0 wird als 0 übernommen |

**Inkonsistenz**: `rate.ts` behandelt Job-Satz 0 als „unset“ (Fallback), die UI-Vorbelegungen
(`??`) behandeln ihn als echten Wert 0. Praktisch fällt das kaum auf, weil `ShiftDialog`/`WorkTimer`
den Job-Satz direkt lesen statt `suggestedRate()` zu nutzen.

## 3. `Customer.rate` und `Project.rate`

- Definiert in `types.ts` (Z. 101, 108) als optionale `rate?: number`.
- Erzeugt in `jobs.tsx` Z. 248: `...(rate ? { rate: ... } : {})` – 0 wird nie gespeichert (weggelassen).
  Projekte werden in `jobs.tsx` Z. 294 **ohne** `rate` angelegt; das Feld ist per UI gar nicht befüllbar.
- Angezeigt in `jobs.tsx` Z. 158–160 und Z. 192, jeweils mit dem Suffix „/h“.
- **Keine Verwendung** in `calc.ts`, `rate.ts`, `resolve.ts`, `service.ts`, `limits.ts`, `payday.ts`,
  `annual*.ts`, `goals.ts`, `export.ts`, `csv.ts`. Sie fließen in **keine** Finanzberechnung ein.
- Einordnung nach Datenmodell (Kunde/Projekt gehören zum Modus „selbstständig“, `Shift.customerId` /
  `Shift.projectId` sind reine Zuordnungen): es handelt sich um **Abrechnungssätze gegenüber Kunden
  bzw. Projekten**, nicht um Arbeitnehmer-Lohnsätze. Sie gehören daher nicht in die Lohn-Hierarchie.

## Empfehlung (nicht umgesetzt)

1. **Lohn-Hierarchie bleibt** Schicht → Job → Standard.
2. `Shift.rate` und `Job.rate` optional machen (`rate?: number`), damit „nicht gesetzt“ (`undefined`)
   sauber von „bewusst 0“ unterscheidbar ist; Formulare speichern bei leerem Feld `undefined`
   statt 0.
3. Danach eine einzige Regel überall: `x !== undefined ? x : nächste Ebene` – d. h. 0 ist ein
   gültiger Satz, `undefined` löst den Fallback aus. Damit verschwindet der Sonderfall
   „Job-Satz 0 = unset“ in `rate.ts` und die abweichende `||`-Kette im CSV-Import.
4. UI-Vorbelegungen (`ShiftDialog`, `WorkTimer`) auf `service.suggestedRate()` umstellen, statt
   `job.rate` direkt zu lesen – ein Auflösungspfad statt drei.
5. `Customer.rate` / `Project.rate` als getrennte **Abrechnungssätze** führen (perspektivisch für
   Rechnungen/Selbstständigkeit) und niemals in `resolveRate` einhängen. Wenn sie dauerhaft ohne
   Funktion bleiben, entweder UI für `Project.rate` ergänzen oder das Feld entfernen.

Punkt 2/3 ist eine Datenmodell-Migration (Alt-Daten mit 0 müssten interpretiert werden) und
sollte erst nach ausdrücklicher Freigabe erfolgen.

---

## Umsetzung (erledigt)

- `Shift.rate` und `Job.rate` sind optional: `undefined` = nicht gesetzt (Fallback), `0` = bewusst 0 EUR/h.
- Hierarchie unverändert: Schicht → Job → Standard, aufgelöst ausschließlich in `rate.ts`
  (`resolveRate`, `effectiveShiftRate`, `parseRateInput`), Einstieg über `service.rateForDate` / `rateOf`.
- Leeres Lohnfeld in `ShiftDialog`/`JobDialog` speichert kein `rate` mehr (kein stilles 0).
- CSV: leere Lohnspalte = nicht gesetzt, importierte 0 bleibt 0; Export schreibt bei fehlendem Satz eine leere Zelle.
- Kompatibilität: `store.normalize` hebt nur gespeicherte **Job**-Sätze von 0 auf `undefined`
  (entspricht exakt dem bisherigen Auflösungsverhalten). Gespeicherte **Schicht**-Sätze von 0
  bleiben unverändert 0 EUR/h, weil sie schon bisher so verrechnet wurden.
- `Customer.rate` / `Project.rate` unverändert und weiterhin außerhalb der Lohnhierarchie.
