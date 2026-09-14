# ACCEPTANCE #5 — Analyse: Krank / Feiertag

Branch: `analyze/krank-feiertag` (from `origin/main` @ e62ba8c + optional display fix).  
Scope: READ-MOSTLY analysis; one pure display-consistency fix in the calendar (see §C / §Fix).  
No schema / Google / Site-URL changes. No business-rule inventing.

Manual findings that triggered this:
- **18.09 Krank:** calendar showed **7,5 h**, entry showed **0,00 h / 0,00 € / „Ohne Entgeltfortzahlung“**.
- **09.09 Feiertag:** entry **0,00 h / 0,00 € / „Ohne Entgeltfortzahlung: Feiertag an freiem Tag…“**.
- User unclear how Krank/Feiertag affect Arbeitszeit, Monatsstunden, Auszahlung, Minijob-Limit.

---

## A) Current data model for day status Krank / Feiertag

### Stored entity

Absence is **not** a separate table. It is a normal `Shift` with `kind`:

```ts
type ShiftKind = "arbeit" | "urlaub" | "krank" | "feiertag";
```

(`src/lib/minijob/types.ts`)

A Krank/Feiertag entry still stores clock fields like work:

| Field | Role for absence |
| --- | --- |
| `kind` | `"krank"` or `"feiertag"` (UI status) |
| `date` | calendar day |
| `jobId` | which job’s plan / startDate / rate apply |
| `start` / `end` / `breakMinutes` | **stored duration** (often from Wochenplan defaults, e.g. 09:00–17:00 − 30 min → **7,5 h**) |
| `rate` | optional override; otherwise job / default rate |

There is **no** persisted flag `paid` / `entgeltfortzahlung`. Payability is **computed** at read time in `shiftPayroll()` (`src/lib/minijob/payroll.ts`).

### How entries are created

1. **Manual** via `ShiftDialog` (`KINDS` includes krank/feiertag); default times 09:00–17:00, pause 30.
2. **Batch absence** via `generateAbsence()` (`schedule.ts`): only on active plan weekdays (or Mo–Fr if flex); copies plan start/end/break (or 09:00–17:00).
3. **Monat aus Festplan** via `generateFixedMonth()`: public holidays become `kind: "feiertag"` with plan times when `holidaysAsFree !== false`.

### Job fields that gate pay

- `job.week` — Festplan; decides *regular workday* and plan hours.
- `job.startDate` — 4-week waiting period for sick pay (§ 3 Abs. 3 EntgFG).
- Without `week`, regularity is inferred from **history** (≥ 2 same weekdays worked in last 28 days).

### Public holiday vs entry kind

- Settings `bundesland` + `holidays.ts` color empty calendar days and drive holiday *supplements* for **Arbeit**.
- Entry `kind: "feiertag"` is independent: user/generator can mark a day Feiertag even if it is not in the holiday calendar (and vice versa).

---

## B) What is calculated today

Central API: `shiftPayroll(shift, { job, history, … })` → `ShiftPayroll`.

### For `kind === "arbeit"`

- `workedHours` = clock hours (`shiftHours`)
- `earnings` = base + supplements
- Counts toward **Monatsstunden** / hours limit

### For `kind === "feiertag"` (§ 2 EntgFG)

| Condition | `reason` | paid? | hours / € |
| --- | --- | --- | --- |
| Not a regular workday | `holiday-off-day` | no | 0 / 0 |
| Regular workday | `holiday-pay` | yes | `paidAbsenceHours` from plan / avg / entry × rate (no supplements) |

### For `kind === "krank"` (§ 3 EntgFG)

| Condition | `reason` | paid? |
| --- | --- | --- |
| Not regular workday | `sick-off-day` | no |
| `< 28` days since `job.startDate` | `sick-waiting` | no |
| ≥ 42 days into same sick case (gap ≤ 7 days) | `sick-exceeded` | no |
| Otherwise | `sick-pay` | yes → plan/avg/entry hours × rate |

If `startDate` is missing, waiting period is **not** checked; paid sick still sets `estimated: true`.

### Aggregates (consumers)

| Consumer | Hours used | Earnings used |
| --- | --- | --- |
| Dashboard „Stunden“ (`index.tsx`) | `workedHours` only | `earnings` (work + paid absence) |
| Minijob earnings limit (`limits.ts`) | — | **all** `earnings` incl. Entgeltfortzahlung (§ 14 SGB IV) |
| Minijob hours limit (`limits.ts`) | `workedHours` only | — |
| Payday expected (`payday.ts`) | worked + paidAbsence (display) | full `earnings` |
| Insights / annual | worked vs `absenceHours` / `absenceEarnings` split | same |
| Entry list (`ShiftList`) | arbeit → worked; absence → `paidAbsenceHours` | `pay.earnings` + reason text |

Documented in `docs/rechtsregeln.md` § Payroll-Semantik.

---

## C) Why calendar vs entry hours can differ

### Root cause (technical inconsistency — fixed)

**Before fix:** `MonthCalendar` summed raw `shiftHours(s)` (start/end − pause) for **every** kind.

**Entry list:** shows `pay.workedHours` or `pay.paidAbsenceHours` from `shiftPayroll`.

So for unpaid Krank/Feiertag:

- Calendar: **7,5 h** (stored clock length, typically plan default)
- Entry: **0,00 h / 0,00 €** + „Ohne Entgeltfortzahlung“ (+ reason)

That matches the manual finding on 18.09. The 7,5 h were **not** „geleistete Arbeitszeit“ and **not** „bezahlte Ausfallstunden“ — only the stored duration on the row.

### Matching the 09.09 Feiertag finding

09.09.2026 = **Mittwoch**. Reason `holiday-off-day` means payroll decided the day is **not** a regular workday for that job (Festplan weekday inactive, or flex without enough Wednesday work history). Correct under current rules; not a calendar bug.

### Related UI mismatch (not changed — UX/business presentation)

`ShiftDialog` preview still uses `shiftBreakdown` (clock hours + full supplements) even for Krank/Feiertag, so the edit dialog can show non-zero hours/€ while the list shows 0 after save. Aligning the dialog is a product choice (preview of clock fields vs payroll outcome).

### Secondary note (history scope)

`ShiftList` passes `history: monthShifts` into `shiftPayroll`, while dashboard/limits use **full** `shifts`. That can skew sick-case / flex-pattern detection near month boundaries. **Not** fixed here (can change paid/unpaid amounts → business outcome). See Owner Decision #3.

---

## D) Impact of status on Arbeitszeit, bezahlte Stunden, Verdienst, Monatslimit, Feiertags-/Kranktage

| Metric (UI / engine) | Arbeit | Krank/Feiertag **bezahlt** | Krank/Feiertag **unbezahlt** |
| --- | --- | --- | --- |
| Geleistete Arbeitszeit (`workedHours`) | yes | **no** (always 0) | no |
| Bezahlte Ausfallstunden (`paidAbsenceHours`) | 0 | yes (plan/avg/entry) | **0** |
| Dashboard „Stunden“ / hours limit | counts | **does not count** | does not count |
| Verdienst / Auszahlung / earnings limit | counts | **counts** as Arbeitsentgelt | **0** |
| Entry list hours | worked | paidAbsence | **0,00 h** |
| Calendar hours (after fix) | worked | paidAbsence | **hidden (0)** |

**Interpretation for the user findings:**

- Unpaid Krank/Feiertag: **no** effect on Monatsstunden, Auszahlung, or Minijob-€-Limit (all stay 0 for that day).
- Paid Krank/Feiertag: **increases Verdienst and €-Limit usage**, **does not** increase „Stunden“ / hours-limit usage (by design, to avoid double-counting).
- Merely having a Krank/Feiertag **row** does not equal a paid sick/holiday day.

There is no separate counter widget „Kranktage / Feiertage“ on the dashboard; annual report exposes `absenceHours` / `absenceEarnings` aggregates.

---

## E) Short technical analysis + behavior options

### Architecture (unchanged)

```
Shift { kind, start, end, … }
        │
        ▼
 shiftPayroll() ──► workedHours | paidAbsenceHours | earnings | reason
        │
        ├── limits / dashboard / payday / insights / annual
        └── ShiftList (and now MonthCalendar) for display hours
```

Clock fields on absences are a **basis fallback** (`basis: "entry"`) when there is no Festplan and no weekday average — not a guarantee of payment.

### Display fix applied (pure consistency)

- `MonthCalendar` now takes `resolve` and shows the **same hour metric as `ShiftList`** (`workedHours` / `paidAbsenceHours`), with full `shifts` as payroll history.
- Unpaid Krank/Feiertag: calendar **no longer** shows 7,5 h.
- Paid absence: calendar shows payroll absence hours (plan/avg), which may still differ from raw start/end if those diverge from the plan — intentional alignment with the entry, not with raw clocks.

### OWNER DECISIONS (do not invent)

1. **Should unpaid absences keep stored start/end at all?**  
   Options: (a) keep as documentation of „would-have-worked“ length; (b) clear/hide times in UI for absence kinds; (c) always overwrite from plan on save. Affects editing UX, not legal calc if payroll stays authoritative.

2. **Should `ShiftDialog` preview use `shiftPayroll`?**  
   Options: show payroll outcome (consistent with list) vs show clock breakdown (consistent with editable time fields). Recommendation: show payroll summary + reason for non-arbeit kinds.

3. **Should `ShiftList` pass full history like limits/dashboard?**  
   Technical correctness for sick-case / flex pattern; **can change €** for edge cases → treat as bugfix with tests, not silent UI tweak.

4. **Product copy / education:**  
   Surface short explainer on absence entries: „Bezahlte Abwesenheit zählt zum Verdienst/Limit, nicht zu den Monatsstunden.“ Reduces confusion without changing rules.

5. **Feiertag on a free day:**  
   Current law-aligned behavior (`holiday-off-day` → 0). Alternative (always pay Feiertag entry) would be a **business-rule change** — out of scope unless owner requests it.

---

## Fix changelog (this branch)

| File | Change |
| --- | --- |
| `src/components/minijob/MonthCalendar.tsx` | Day hours from `shiftPayroll` (match ShiftList); require `resolve` |
| `src/routes/index.tsx` | Pass `resolve={resolve}` into calendar |
| `KRANK_FEIERTAG_ANALYSIS.md` | This document |

No PR opened if only analysis is desired; PR is appropriate **only** for the display-consistency commit.
