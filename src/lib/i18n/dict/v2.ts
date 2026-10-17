import type { Bundle } from "../core";

/** Version 2: Minijob-Doppellimit, Zahltag-Verwaltung. */
export const v2: Bundle = {
  de: {
    "limit.title": "Minijob-Grenze",
    "limit.earnings": "Verdienst genutzt",
    "limit.hours": "Stunden genutzt",
    "limit.leftAmount": "noch {amount}",
    "limit.leftHours": "noch {hours}",
    "limit.autoHint": "{hours} bei {rate}/Std.",
    "limit.month": "Monat",
    "limit.year": "Jahr",
    "limit.notApplicable": "Nicht anwendbar (kein Minijob)",
    "limit.notApplicableHint": "Die Minijob-Grenze gilt nur für Jobs mit der Beschäftigungsart Minijob – unabhängig von flexibler oder fester Planung.",
    "limit.multipleMinijobs": "Mehrere Minijobs neben Hauptbeschäftigung",
    "limit.multipleMinijobsHint":
      "Diese Karte kann mehrere Minijobs neben einer Hauptbeschäftigung nicht korrekt berücksichtigen und zeigt deshalb keinen Status. Neben einer Hauptbeschäftigung bleibt in der Regel nur der zuerst aufgenommene Minijob geringfügig; weitere werden mit der Hauptbeschäftigung zusammengerechnet. Bitte lass das prüfen (z. B. Minijob-Zentrale oder Krankenkasse).",
    "limit.multipleMinijobsSum": "Summe aller Minijobs (nur zur Information): {amount}",
    "limit.multipleMinijobsMonths":
      "Betroffene Monate (Hauptbeschäftigung + mindestens zwei in diesem Monat aktive Minijobs): {months}",
    "limit.multipleMinijobsFilterNote":
      "Hinweis trotz Filter: Die Summen zeigen nur den gewählten Job. Ob die Grenze belastbar bewertet werden kann, hängt aber von allen gleichzeitig ausgeübten Beschäftigungen ab – deshalb bleibt der Hinweis bestehen.",
    "limit.overExplain": "Eine Überschreitung kann steuer- und sozialversicherungsrechtlich relevant sein. Die genaue Behandlung hängt von deiner persönlichen Situation ab.",
    "limit.disclaimer": "Kein individueller Steuer- oder Rechtsrat. Die App berechnet keine Steuern oder Abgaben.",

    "pay.title": "Zahltag",
    "pay.period": "Abrechnung {month}",
    "pay.expected": "Erwartet",
    "pay.due": "Fällig am {date}",
    "pay.actual": "Erhalten",
    "pay.earned": "Verdient",
    "pay.paid": "Ausgezahlt",
    "pay.open": "Offen",
    "pay.overdue": "Zahlung überfällig",
    "pay.enter": "Zahlung erfassen",
    "pay.save": "Speichern",
    "pay.saved": "Zahlung gespeichert",
    "pay.diffPlus": "{amount} mehr als erwartet",
    "pay.diffMinus": "{amount} weniger als erwartet",
    "pay.diffOk": "Betrag stimmt",
    "pay.none": "Keine Abrechnung in diesem Monat.",
    "pay.add": "Zahlung hinzufügen",
    "pay.edit": "Zahlung bearbeiten",
    "pay.delete": "Zahlung löschen",
    "pay.deleted": "Zahlung gelöscht",
    "pay.invalid": "Bitte einen Betrag größer als 0 eingeben.",
    "pay.payments": "Teilzahlungen",
    "pay.overpaid": "Überzahlt",
    "pay.paymentDiff": "Verdient − Ausgezahlt",

    "job.payday": "Zahltag (Tag im Monat)",
    "job.startDate": "Beschäftigungsbeginn",
    "job.startDateHint":
      "Basis der 4-Wochen-Wartezeit für Lohnfortzahlung im Krankheitsfall (§ 3 Abs. 3 EntgFG). Vor dem Startdatum werden keine Sollstunden angesetzt. Ab dem Startdatum gelten die regulären Soll-Regeln.",
    "pay.absencePaid": "Bezahlte Abwesenheit",
    "pay.absenceUnpaid": "Ohne Entgeltfortzahlung",
    "pay.estimate": "Geschätzte Basis",
    "pay.reason.holiday-pay": "Feiertag an regulärem Arbeitstag (§ 2 EntgFG)",
    "pay.reason.holiday-off-day": "Feiertag an freiem Tag – keine Fortzahlung",
    "pay.reason.sick-pay": "Lohnfortzahlung im Krankheitsfall (§ 3 EntgFG)",
    "pay.reason.sick-waiting": "Wartezeit von 4 Wochen noch nicht erfüllt",
    "pay.reason.sick-exceeded": "6-Wochen-Frist je Krankheitsfall überschritten",
    "pay.notice.sick-case-ambiguous":
      "Krankheitsfall unklar: angrenzende Einträge wurden nicht automatisch zusammengefasst – bitte prüfen.",
    "pay.notice.sick-legacy-over-limit":
      "Abweichung nach Krankheitsfall-Regel (über 6 Wochen) – nicht automatisch neu berechnet; Neuberechnung nur nach Bestätigung.",
    "pay.notice.sick-case-long-gap":
      "Langer planfreier Zeitraum zwischen Krankheitstagen – ggf. zwei getrennte Erkrankungen; als ein vermuteter Fall gewertet, bitte prüfen.",
    "sickRecalc.title": "Krankheitsfall-Regel: Neuberechnung offen",
    "sickRecalc.body":
      "In {count} Monat(en) weichen Krankheitstage von der Krankheitsfall-Regel ab (über 6 Wochen je vermutetem Fall). Ohne deine Bestätigung bleiben alle Beträge unverändert.",
    "sickRecalc.review": "Monate prüfen",
    "sickRecalc.hide": "Ausblenden",
    "sickRecalc.row": "{days} Krankheitstag(e) · bisher {before} → neu {after}",
    "sickRecalc.confirm": "Ausgewählte Monate neu berechnen",
    "sickRecalc.cancel": "Abbrechen",
    "sickRecalc.noneSelected": "Kein Monat ausgewählt – es wird nichts geändert.",
    "set.defaults.rateBelowMinimum":
      "Hinweis: Dein Standard-Stundenlohn liegt ab {date} unter dem gesetzlichen Mindestlohn ({min}). Gespeicherte Sätze werden nicht automatisch geändert – bitte bei Bedarf selbst anpassen.",
    "sickRecalc.reviewDays":
      "Bitte prüfen: {count} Tag(e) mit unklarer Fallgrenze oder ungewöhnlich langer Unterbrechung.",
    "pay.notice.sick-case-possibly-separate":
      "Möglicherweise verschiedene Erkrankungen: Zwischen diesen Krankheitstagen liegen 6 oder mehr Kalendertage ohne Krankheit – nicht automatisch zu einem Fall zusammengefasst, Neuberechnung nur nach deiner Bestätigung.",
    "sickRecalc.separateDays":
      "Möglicherweise verschiedene Erkrankungen: {count} Tag(e) nach einer Unterbrechung von 6 oder mehr Kalendertagen – bitte vor der Bestätigung prüfen.",
    "retro.title":
      "Änderung wirkt auf andere Einträge",
    "retro.body":
      "Diese Änderung berechnet bereits erfasste Einträge in folgenden Monaten anders. Ohne Bestätigung wird nichts gespeichert.",
    "retro.row":
      "bisher {before} → neu {after}",
    "retro.lapsed":
      "Bestätigte Krankheitsfall-Neuberechnung wird aufgehoben für: {months}. Danach bitte erneut prüfen.",
    "retro.cancel":
      "Abbrechen",
    "retro.confirm":
      "Trotzdem speichern",
    "retro.range":
      "Dieser Zeitraum: bisher {daysBefore} Tage, {before} → neu {daysAfter} Tage, {after}",
    "retro.rangeLost":
      "Diese Einträge im Zeitraum entfallen ohne Ersatz (laut gültigem Wochenplan frei): {days}",
    "absence.unchanged":
      "Keine Änderung – der Zeitraum bleibt unverändert.",
    "absence.unknownPlanSkipped":
      "{count} Tag(e) nicht eingetragen: Für diese Tage ist der damals gültige Wochenplan nicht bekannt.",
    "sickLapsed.title":
      "Bestätigung aufgehoben – bitte erneut prüfen",
    "sickLapsed.body":
      "Die Krankheitstage haben sich geändert, deshalb gilt deine frühere Bestätigung der Krankheitsfall-Neuberechnung nicht mehr für: {months}. Die Beträge folgen wieder der unbestätigten Berechnung.",
    "sickLapsed.dismiss":
      "Verstanden",
    "limit.multipleMinijobsOtherMonths":
      "Im gewählten Monat ist keine Mehrfachbeschäftigung erfasst – der Hinweis entsteht durch die oben genannten anderen Monate dieses Zeitraums.",
    "limit.multipleMinijobsForecastBasis":
      "Dieser Hinweis beruht nur auf erfassten Einträgen der 12 Monate bis zum gewählten Monat (Rückblick). Er ist keine Vorhersage und keine Feststellung künftiger Beschäftigungen.",
    "limit.o4Uncertain":
      "Mehrfachbeschäftigung nicht sicher bestimmbar",
    "limit.o4UncertainHint":
      "Ob neben der Hauptbeschäftigung mehrere Minijobs gleichzeitig aktiv waren, lässt sich aus den Daten nicht sicher bestimmen: Die Bezahlung einzelner Krankheits- oder Feiertage ist nur geschätzt (z. B. ohne Wochenplan oder Beschäftigungsbeginn) oder hängt noch von einer Bestätigung ab. Deshalb wird kein Grenzstatus angezeigt.",
    "limit.o4UncertainMonths":
      "Nicht sicher bestimmbar in: {months}",
    "sick.linkCase":
      "Zum Krankheitsfall ab {date} hinzufügen (nur wenn es dieselbe Erkrankung ist). Ohne Haken wird der Tag getrennt gezählt.",
    "sick.ambiguousHelp":
      "Die Grenze zum vorherigen Krankheitszeitraum ist unklar. Warst du an den fehlenden Arbeitstagen ebenfalls krank, trage sie bitte als Krankheitstage ein.",
    "pay.reason.sick-off-day": "Kein regulärer Arbeitstag",
    "pay.reason.vacation-pay": "Urlaubsentgelt",
    "pay.basis.average13": "13-Wochen-Durchschnitt",
    "pay.basis.plan": "Regelmäßige Arbeitszeit laut Plan",
    "pay.basis.entry": "Zeiten dieses Eintrags",
    "pay.absenceHours": "Ausfallstunden (nicht geleistet)",
    "job.payroll": "Auszahlung",
    "job.payrollSame": "Selber Monat",
    "job.payrollNext": "Folgemonat",
    "job.notes": "Notizen",
    "job.tabPay": "Lohn",

    "set.defaults.hoursLimit": "Stundengrenze pro Monat",
    "set.limits.legalAuto": "Gesetzliche Minijob-Grenze verwenden",
    "set.limits.legalAutoHint": "Stichtagsbezogen aus dem gesetzlichen Mindestlohn",
    "set.limits.legalSource": "Gesetzliche Grenze",
    "set.limits.auto": "Automatisch berechnet",
    "set.limits.formula": "Jahresgrenze = Monatsgrenze × 12",
    "set.limits.hoursAuto": "Stundengrenze automatisch berechnen",
    "set.limits.hoursAutoHint": "Aus Monatsgrenze ÷ Stundenlohn",

    "notify.payday.title": "Zahltag",
    "notify.payday.body": "Für {job} werden heute etwa {amount} erwartet.",
    "notify.limitHours.title": "Stundengrenze",
    "notify.limitHours.body": "Du hast {percent} % deiner Monatsstunden genutzt.",
  },
  en: {
    "limit.title": "Mini-job limit",
    "limit.earnings": "Earnings used",
    "limit.hours": "Hours used",
    "limit.leftAmount": "{amount} left",
    "limit.leftHours": "{hours} left",
    "limit.autoHint": "{hours} at {rate}/hr",
    "limit.month": "Month",
    "limit.year": "Year",
    "limit.notApplicable": "Not applicable (no minijob)",
    "limit.notApplicableHint": "The minijob limit only applies to jobs with employment type minijob – regardless of flexible or fixed planning.",
    "limit.multipleMinijobs": "Several minijobs alongside a main job",
    "limit.multipleMinijobsHint":
      "This card cannot correctly account for several minijobs alongside a main job and therefore shows no status. Alongside a main job, usually only the first minijob taken up stays marginal; further ones are added to the main job. Please have this checked (e.g. Minijob-Zentrale or your health insurer).",
    "limit.multipleMinijobsSum": "Total of all minijobs (for information only): {amount}",
    "limit.multipleMinijobsMonths":
      "Affected months (main job + at least two minijobs active in that month): {months}",
    "limit.multipleMinijobsFilterNote":
      "Notice despite the filter: the totals show only the selected job. Whether the limit can be assessed reliably depends on all jobs held at the same time, so the notice remains.",
    "limit.overExplain": "Exceeding the limit can matter for tax and social-security treatment. The exact outcome depends on your personal circumstances.",
    "limit.disclaimer": "Not individual tax or legal advice. The app does not calculate taxes or social contributions.",

    "pay.title": "Payday",
    "pay.period": "Payroll {month}",
    "pay.expected": "Expected",
    "pay.due": "Due on {date}",
    "pay.actual": "Received",
    "pay.earned": "Earned",
    "pay.paid": "Paid",
    "pay.open": "Open",
    "pay.overdue": "Payment overdue",
    "pay.enter": "Record payment",
    "pay.save": "Save",
    "pay.saved": "Payment saved",
    "pay.diffPlus": "{amount} more than expected",
    "pay.diffMinus": "{amount} less than expected",
    "pay.diffOk": "Amount matches",
    "pay.none": "No payroll for this month.",
    "pay.add": "Add payment",
    "pay.edit": "Edit payment",
    "pay.delete": "Delete payment",
    "pay.deleted": "Payment deleted",
    "pay.invalid": "Enter an amount greater than 0.",
    "pay.payments": "Partial payments",
    "pay.overpaid": "Overpaid",
    "pay.paymentDiff": "Earned − Paid",

    "job.payday": "Payday (day of month)",
    "job.startDate": "Employment start",
    "job.startDateHint":
      "Basis for the 4-week waiting period for sick pay (§ 3 EntgFG). No target hours are applied before the start date. From the start date, the regular target-hour rules apply.",
    "pay.absencePaid": "Paid absence",
    "pay.absenceUnpaid": "No continued pay",
    "pay.estimate": "Estimated basis",
    "pay.reason.holiday-pay": "Public holiday on a regular working day (§ 2 EntgFG)",
    "pay.reason.holiday-off-day": "Holiday on a day off – no pay",
    "pay.reason.sick-pay": "Continued pay while sick (§ 3 EntgFG)",
    "pay.reason.sick-waiting": "4-week waiting period not yet met",
    "pay.reason.sick-exceeded": "6-week limit per illness exceeded",
    "pay.notice.sick-case-ambiguous":
      "Unclear sickness case: adjacent entries were not merged automatically – please check.",
    "pay.notice.sick-legacy-over-limit":
      "Differs under the sickness-case rule (beyond 6 weeks) – not recalculated automatically; recalculation only after confirmation.",
    "pay.notice.sick-case-long-gap":
      "Long non-working gap between sick days – possibly two separate illnesses; treated as one presumed case, please check.",
    "sickRecalc.title": "Sickness-case rule: recalculation pending",
    "sickRecalc.body":
      "In {count} month(s), sick days differ under the sickness-case rule (beyond 6 weeks per presumed case). Without your confirmation all amounts stay unchanged.",
    "sickRecalc.review": "Review months",
    "sickRecalc.hide": "Hide",
    "sickRecalc.row": "{days} sick day(s) · currently {before} → new {after}",
    "sickRecalc.confirm": "Recalculate selected months",
    "sickRecalc.cancel": "Cancel",
    "sickRecalc.noneSelected": "No month selected – nothing will change.",
    "set.defaults.rateBelowMinimum":
      "Note: from {date} your default hourly rate is below the statutory minimum wage ({min}). Saved rates are never changed automatically – please adjust them yourself if needed.",
    "sickRecalc.reviewDays":
      "Please check: {count} day(s) with an unclear case boundary or an unusually long gap.",
    "pay.notice.sick-case-possibly-separate":
      "Possibly different illnesses: there are 6 or more calendar days without sickness between these sick days – not merged into one case automatically; recalculation only after your confirmation.",
    "sickRecalc.separateDays":
      "Possibly different illnesses: {count} day(s) after a break of 6 or more calendar days – please check before confirming.",
    "retro.title":
      "This change affects other entries",
    "retro.body":
      "This change recalculates entries already recorded in the following months. Nothing is saved without your confirmation.",
    "retro.row":
      "before {before} → new {after}",
    "retro.lapsed":
      "Confirmed sick-case recalculation will be revoked for: {months}. Please review again afterwards.",
    "retro.cancel":
      "Cancel",
    "retro.confirm":
      "Save anyway",
    "retro.range":
      "This period: before {daysBefore} days, {before} → after {daysAfter} days, {after}",
    "retro.rangeLost":
      "These entries in the period are removed without replacement (day off in the valid schedule): {days}",
    "absence.unchanged":
      "No change – the period stays as it is.",
    "absence.unknownPlanSkipped":
      "{count} day(s) not added: the schedule valid on these days is unknown.",
    "sickLapsed.title":
      "Confirmation revoked – please review again",
    "sickLapsed.body":
      "Your sick days changed, so your earlier confirmation of the sick-case recalculation no longer applies to: {months}. Amounts follow the unconfirmed calculation again.",
    "sickLapsed.dismiss":
      "Got it",
    "limit.multipleMinijobsOtherMonths":
      "No multiple employment is recorded in the selected month – the notice comes from the other months of this period listed above.",
    "limit.multipleMinijobsForecastBasis":
      "This notice is based only on recorded entries of the 12 months up to the selected month (look-back). It is not a prediction and not a statement about future employment.",
    "limit.o4Uncertain":
      "Multiple employment cannot be determined reliably",
    "limit.o4UncertainHint":
      "Whether several Minijobs were active at the same time alongside the main job cannot be determined reliably from the data: pay for some sick days or public holidays is only estimated (e.g. no weekly plan or employment start) or still depends on a confirmation. Therefore no limit status is shown.",
    "limit.o4UncertainMonths":
      "Cannot be determined reliably in: {months}",
    "sick.linkCase":
      "Add to the sickness case starting {date} (only if it is the same illness). Unticked, the day is counted separately.",
    "sick.ambiguousHelp":
      "The boundary to the previous sickness period is unclear. If you were also sick on the missing working days, please enter them as sick days.",
    "pay.reason.sick-off-day": "Not a regular working day",
    "pay.reason.vacation-pay": "Holiday pay",
    "pay.basis.average13": "13-week average",
    "pay.basis.plan": "Regular working time per plan",
    "pay.basis.entry": "Times of this entry",
    "pay.absenceHours": "Absence hours (not worked)",
    "job.payroll": "Payout",
    "job.payrollSame": "Same month",
    "job.payrollNext": "Next month",
    "job.notes": "Notes",
    "job.tabPay": "Pay",

    "set.defaults.hoursLimit": "Monthly hours limit",
    "set.limits.legalAuto": "Use statutory minijob limit",
    "set.limits.legalAutoHint": "Derived from the statutory minimum wage per effective date",
    "set.limits.legalSource": "Statutory limit",
    "set.limits.auto": "Automatically calculated",
    "set.limits.formula": "Yearly limit = monthly limit × 12",
    "set.limits.hoursAuto": "Calculate hours limit automatically",
    "set.limits.hoursAutoHint": "From income limit ÷ hourly rate",

    "notify.payday.title": "Payday",
    "notify.payday.body": "About {amount} is expected today for {job}.",
    "notify.limitHours.title": "Hours limit",
    "notify.limitHours.body": "You have used {percent}% of your monthly hours.",
  },
  ru: {
    "limit.title": "Лимит мини-джоба",
    "limit.earnings": "Заработок использован",
    "limit.hours": "Часы использованы",
    "limit.leftAmount": "осталось {amount}",
    "limit.leftHours": "осталось {hours}",
    "limit.autoHint": "{hours} при {rate}/час",
    "limit.month": "Месяц",
    "limit.year": "Год",
    "limit.notApplicable": "Не применимо (самозанятость)",
    "limit.notApplicableHint": "Лимит миниджоба для работников здесь не действует.",
    "limit.multipleMinijobs": "Несколько миниджобов при основной работе",
    "limit.multipleMinijobsHint":
      "Эта карточка не может корректно учесть несколько миниджобов при основной работе, поэтому статус не показывается. При основной работе обычно только первый начатый миниджоб остаётся минимальным; остальные суммируются с основной работой. Пожалуйста, уточните (например, в Minijob-Zentrale или больничной кассе).",
    "limit.multipleMinijobsSum": "Сумма всех миниджобов (только для информации): {amount}",
    "limit.multipleMinijobsMonths":
      "Затронутые месяцы (основная работа + не менее двух миниджобов, активных в этом месяце): {months}",
    "limit.multipleMinijobsFilterNote":
      "Предупреждение несмотря на фильтр: суммы показывают только выбранную работу. Но можно ли надёжно оценить лимит, зависит от всех одновременных работ, поэтому предупреждение сохраняется.",
    "limit.overExplain": "Превышение лимита может иметь значение для налогов и соцстрахования. Точные последствия зависят от вашей ситуации.",
    "limit.disclaimer": "Это не индивидуальная налоговая или юридическая консультация. Приложение не рассчитывает налоги или взносы.",

    "pay.title": "День выплаты",
    "pay.period": "Расчёт за {month}",
    "pay.expected": "Ожидается",
    "pay.due": "Срок: {date}",
    "pay.actual": "Получено",
    "pay.earned": "Заработано",
    "pay.paid": "Выплачено",
    "pay.open": "Осталось",
    "pay.overdue": "Срок выплаты истёк",
    "pay.enter": "Внести выплату",
    "pay.save": "Сохранить",
    "pay.saved": "Выплата сохранена",
    "pay.diffPlus": "на {amount} больше ожидаемого",
    "pay.diffMinus": "на {amount} меньше ожидаемого",
    "pay.diffOk": "Сумма совпадает",
    "pay.none": "В этом месяце расчётов нет.",
    "pay.add": "Добавить выплату",
    "pay.edit": "Изменить выплату",
    "pay.delete": "Удалить выплату",
    "pay.deleted": "Выплата удалена",
    "pay.invalid": "Введите сумму больше 0.",
    "pay.payments": "Частичные выплаты",
    "pay.overpaid": "Переплата",
    "pay.paymentDiff": "Заработано − Выплачено",

    "job.payday": "День выплаты (число месяца)",
    "job.startDate": "Начало занятости",
    "job.startDateHint":
      "Основа 4-недельного срока ожидания оплаты больничного (§ 3 EntgFG). До даты начала плановые часы не начисляются. С даты начала действуют обычные правила плановых часов.",
    "pay.absencePaid": "Оплачиваемое отсутствие",
    "pay.absenceUnpaid": "Без сохранения оплаты",
    "pay.estimate": "Оценочная основа",
    "pay.reason.holiday-pay": "Праздник в обычный рабочий день (§ 2 EntgFG)",
    "pay.reason.holiday-off-day": "Праздник в выходной — без оплаты",
    "pay.reason.sick-pay": "Оплата больничного (§ 3 EntgFG)",
    "pay.reason.sick-waiting": "4 недели ожидания ещё не прошли",
    "pay.reason.sick-exceeded": "Превышен лимит 6 недель",
    "pay.notice.sick-case-ambiguous":
      "Неясный случай болезни: соседние записи не объединены автоматически — проверьте.",
    "pay.notice.sick-legacy-over-limit":
      "Расхождение по правилу случая болезни (сверх 6 недель) — не пересчитано автоматически; пересчёт только после подтверждения.",
    "pay.notice.sick-case-long-gap":
      "Длинный нерабочий промежуток между днями болезни — возможно, две отдельные болезни; учтено как один случай, проверьте.",
    "sickRecalc.title": "Правило случая болезни: пересчёт не подтверждён",
    "sickRecalc.body":
      "В {count} мес. дни болезни расходятся с правилом случая болезни (сверх 6 недель на предполагаемый случай). Без вашего подтверждения суммы не меняются.",
    "sickRecalc.review": "Проверить месяцы",
    "sickRecalc.hide": "Скрыть",
    "sickRecalc.row": "Дней болезни: {days} · сейчас {before} → после {after}",
    "sickRecalc.confirm": "Пересчитать выбранные месяцы",
    "sickRecalc.cancel": "Отмена",
    "sickRecalc.noneSelected": "Месяцы не выбраны — ничего не изменится.",
    "set.defaults.rateBelowMinimum":
      "Внимание: с {date} ваша стандартная ставка ниже установленной законом минимальной оплаты ({min}). Сохранённые ставки не меняются автоматически – при необходимости измените их сами.",
    "sickRecalc.reviewDays":
      "Проверьте: {count} дн. с неясной границей случая или необычно долгим перерывом.",
    "pay.notice.sick-case-possibly-separate":
      "Возможно, разные болезни: между этими днями болезни 6 или более календарных дней без болезни – они не объединяются в один случай автоматически; пересчёт только после вашего подтверждения.",
    "sickRecalc.separateDays":
      "Возможно, разные болезни: {count} дн. после перерыва в 6 или более календарных дней – проверьте перед подтверждением.",
    "retro.title":
      "Изменение затрагивает другие записи",
    "retro.body":
      "Это изменение пересчитывает уже внесённые записи в следующих месяцах. Без подтверждения ничего не сохраняется.",
    "retro.row":
      "было {before} → станет {after}",
    "retro.lapsed":
      "Подтверждённый пересчёт по случаю болезни будет отменён для: {months}. После этого проверьте ещё раз.",
    "retro.cancel":
      "Отмена",
    "retro.confirm":
      "Всё равно сохранить",
    "retro.range":
      "Этот период: было {daysBefore} дн., {before} → станет {daysAfter} дн., {after}",
    "retro.rangeLost":
      "Эти записи в периоде будут удалены без замены (выходной по действующему графику): {days}",
    "absence.unchanged":
      "Без изменений – период остаётся прежним.",
    "absence.unknownPlanSkipped":
      "Не добавлено дней: {count} – действовавший в эти дни график неизвестен.",
    "sickLapsed.title":
      "Подтверждение снято – проверьте ещё раз",
    "sickLapsed.body":
      "Дни болезни изменились, поэтому ваше прежнее подтверждение пересчёта больше не действует для: {months}. Суммы снова считаются без подтверждения.",
    "sickLapsed.dismiss":
      "Понятно",
    "limit.multipleMinijobsOtherMonths":
      "В выбранном месяце несколько занятостей не зафиксировано – уведомление вызвано другими месяцами этого периода, указанными выше.",
    "limit.multipleMinijobsForecastBasis":
      "Это уведомление основано только на внесённых записях за 12 месяцев до выбранного месяца (ретроспектива). Это не прогноз и не утверждение о будущих занятостях.",
    "limit.o4Uncertain":
      "Совместительство нельзя определить надёжно",
    "limit.o4UncertainHint":
      "По данным нельзя надёжно определить, были ли наряду с основной работой одновременно активны несколько миниджобов: оплата отдельных дней болезни или праздников лишь оценочная (например, нет недельного плана или даты начала работы) или ещё зависит от подтверждения. Поэтому статус лимита не показывается.",
    "limit.o4UncertainMonths":
      "Нельзя надёжно определить в: {months}",
    "sick.linkCase":
      "Добавить к случаю болезни с {date} (только если это то же заболевание). Без отметки день считается отдельно.",
    "sick.ambiguousHelp":
      "Граница с предыдущим периодом болезни неясна. Если вы болели и в пропущенные рабочие дни, внесите их как дни болезни.",
    "pay.reason.sick-off-day": "Не обычный рабочий день",
    "pay.reason.vacation-pay": "Отпускные",
    "pay.basis.average13": "Среднее за 13 недель",
    "pay.basis.plan": "Обычное рабочее время по плану",
    "pay.basis.entry": "Время этой записи",
    "pay.absenceHours": "Часы отсутствия (не отработаны)",
    "job.payroll": "Выплата",
    "job.payrollSame": "Тот же месяц",
    "job.payrollNext": "Следующий месяц",
    "job.notes": "Заметки",
    "job.tabPay": "Оплата",

    "set.defaults.hoursLimit": "Лимит часов в месяц",
    "set.limits.legalAuto": "Использовать установленный законом лимит",
    "set.limits.legalAutoHint": "Из установленной законом минимальной оплаты на дату",
    "set.limits.legalSource": "Законный лимит",
    "set.limits.auto": "Рассчитано автоматически",
    "set.limits.formula": "Годовой лимит = месячный × 12",
    "set.limits.hoursAuto": "Считать лимит часов автоматически",
    "set.limits.hoursAutoHint": "Из месячного лимита ÷ ставка",

    "notify.payday.title": "День выплаты",
    "notify.payday.body": "Сегодня по «{job}» ожидается около {amount}.",
    "notify.limitHours.title": "Лимит часов",
    "notify.limitHours.body": "Использовано {percent}% месячных часов.",
  },
  tr: {
    "limit.title": "Minijob sınırı",
    "limit.earnings": "Kullanılan kazanç",
    "limit.hours": "Kullanılan saat",
    "limit.leftAmount": "{amount} kaldı",
    "limit.leftHours": "{hours} kaldı",
    "limit.autoHint": "{rate}/saat ile {hours}",
    "limit.month": "Ay",
    "limit.year": "Yıl",
    "limit.notApplicable": "Uygulanamaz (serbest çalışan)",
    "limit.notApplicableHint": "Çalışan minijob limiti burada geçerli değildir.",
    "limit.multipleMinijobs": "Ana işin yanında birden fazla minijob",
    "limit.multipleMinijobsHint":
      "Bu kart, ana işin yanındaki birden fazla minijobu doğru hesaba katamaz ve bu nedenle durum göstermez. Ana işin yanında genellikle yalnızca ilk başlanan minijob muaf kalır; diğerleri ana işle toplanır. Lütfen kontrol ettirin (ör. Minijob-Zentrale veya sağlık sigortası).",
    "limit.multipleMinijobsSum": "Tüm minijobların toplamı (yalnızca bilgi için): {amount}",
    "limit.multipleMinijobsMonths":
      "Etkilenen aylar (ana iş + o ay en az iki aktif minijob): {months}",
    "limit.multipleMinijobsFilterNote":
      "Filtreye rağmen uyarı: Toplamlar yalnızca seçilen işi gösterir. Sınırın güvenilir değerlendirilip değerlendirilemeyeceği aynı anda yapılan tüm işlere bağlıdır; bu yüzden uyarı kalır.",
    "limit.overExplain": "Sınırın aşılması vergi ve sosyal güvenlik açısından önemli olabilir. Kesin sonuç kişisel durumuna bağlıdır.",
    "limit.disclaimer": "Bireysel vergi veya hukuk danışmanlığı değildir. Uygulama vergi veya prim hesaplamaz.",

    "pay.title": "Ödeme günü",
    "pay.period": "{month} bordrosu",
    "pay.expected": "Beklenen",
    "pay.due": "Vade: {date}",
    "pay.actual": "Alınan",
    "pay.earned": "Kazanılan",
    "pay.paid": "Ödenen",
    "pay.open": "Açık",
    "pay.overdue": "Ödeme gecikmiş",
    "pay.enter": "Ödemeyi kaydet",
    "pay.save": "Kaydet",
    "pay.saved": "Ödeme kaydedildi",
    "pay.diffPlus": "beklenenden {amount} fazla",
    "pay.diffMinus": "beklenenden {amount} az",
    "pay.diffOk": "Tutar uyuyor",
    "pay.none": "Bu ay için bordro yok.",
    "pay.add": "Ödeme ekle",
    "pay.edit": "Ödemeyi düzenle",
    "pay.delete": "Ödemeyi sil",
    "pay.deleted": "Ödeme silindi",
    "pay.invalid": "0'dan büyük bir tutar girin.",
    "pay.payments": "Kısmi ödemeler",
    "pay.overpaid": "Fazla ödeme",
    "pay.paymentDiff": "Kazanılan − Ödenen",

    "job.payday": "Ödeme günü (ayın günü)",
    "job.startDate": "İşe başlama",
    "job.startDateHint":
      "Hastalıkta ücret ödemesi için 4 haftalık bekleme süresinin temeli (§ 3 EntgFG). Başlangıç tarihinden önce hedef saat hesaplanmaz. Başlangıç tarihinden itibaren normal hedef saat kuralları geçerlidir.",
    "pay.absencePaid": "Ücretli devamsızlık",
    "pay.absenceUnpaid": "Ücret ödemesi yok",
    "pay.estimate": "Tahmini temel",
    "pay.reason.holiday-pay": "Normal çalışma gününe denk gelen tatil (§ 2 EntgFG)",
    "pay.reason.holiday-off-day": "İzin gününde tatil – ödeme yok",
    "pay.reason.sick-pay": "Hastalıkta ücret ödemesi (§ 3 EntgFG)",
    "pay.reason.sick-waiting": "4 haftalık bekleme süresi dolmadı",
    "pay.reason.sick-exceeded": "Hastalık başına 6 hafta aşıldı",
    "pay.notice.sick-case-ambiguous":
      "Belirsiz hastalık durumu: bitişik kayıtlar otomatik birleştirilmedi – lütfen kontrol edin.",
    "pay.notice.sick-legacy-over-limit":
      "Hastalık durumu kuralına göre fark (6 haftayı aşıyor) – otomatik yeniden hesaplanmadı; yalnızca onaydan sonra yeniden hesaplanır.",
    "pay.notice.sick-case-long-gap":
      "Hastalık günleri arasında uzun çalışılmayan süre – muhtemelen iki ayrı hastalık; tek durum sayıldı, lütfen kontrol edin.",
    "sickRecalc.title": "Hastalık durumu kuralı: yeniden hesaplama bekliyor",
    "sickRecalc.body":
      "{count} ayda hastalık günleri hastalık durumu kuralından farklı (varsayılan durum başına 6 haftayı aşıyor). Onayınız olmadan tüm tutarlar değişmez.",
    "sickRecalc.review": "Ayları incele",
    "sickRecalc.hide": "Gizle",
    "sickRecalc.row": "{days} hastalık günü · şu an {before} → yeni {after}",
    "sickRecalc.confirm": "Seçili ayları yeniden hesapla",
    "sickRecalc.cancel": "İptal",
    "sickRecalc.noneSelected": "Ay seçilmedi – hiçbir şey değişmez.",
    "set.defaults.rateBelowMinimum":
      "Not: {date} tarihinden itibaren varsayılan saatlik ücretiniz yasal asgari ücretin ({min}) altında. Kayıtlı ücretler otomatik olarak değiştirilmez – gerekirse kendiniz düzenleyin.",
    "sickRecalc.reviewDays":
      "Lütfen kontrol edin: vaka sınırı belirsiz veya alışılmadık uzun aralı {count} gün.",
    "pay.notice.sick-case-possibly-separate":
      "Muhtemelen farklı hastalıklar: Bu hastalık günleri arasında hastalıksız 6 veya daha fazla takvim günü var – otomatik olarak tek vakada birleştirilmez; yeniden hesaplama yalnızca onayınızdan sonra.",
    "sickRecalc.separateDays":
      "Muhtemelen farklı hastalıklar: 6 veya daha fazla takvim günlük aradan sonra {count} gün – lütfen onaylamadan önce kontrol edin.",
    "retro.title":
      "Bu değişiklik diğer kayıtları etkiliyor",
    "retro.body":
      "Bu değişiklik aşağıdaki aylardaki mevcut kayıtları farklı hesaplar. Onay olmadan hiçbir şey kaydedilmez.",
    "retro.row":
      "önce {before} → yeni {after}",
    "retro.lapsed":
      "Onaylanmış hastalık vakası yeniden hesaplaması şu aylar için kaldırılacak: {months}. Ardından lütfen tekrar kontrol edin.",
    "retro.cancel":
      "İptal",
    "retro.confirm":
      "Yine de kaydet",
    "retro.range":
      "Bu dönem: önce {daysBefore} gün, {before} → sonra {daysAfter} gün, {after}",
    "retro.rangeLost":
      "Dönemdeki bu kayıtlar yerine yenisi olmadan kaldırılır (geçerli plana göre izin günü): {days}",
    "absence.unchanged":
      "Değişiklik yok – dönem aynı kalıyor.",
    "absence.unknownPlanSkipped":
      "{count} gün eklenmedi: bu günlerde geçerli olan çalışma planı bilinmiyor.",
    "sickLapsed.title":
      "Onay kaldırıldı – lütfen tekrar kontrol edin",
    "sickLapsed.body":
      "Hastalık günleri değişti; bu nedenle önceki yeniden hesaplama onayınız şu aylar için artık geçerli değil: {months}. Tutarlar yeniden onaysız hesaplamaya göre gösterilir.",
    "sickLapsed.dismiss":
      "Anladım",
    "limit.multipleMinijobsOtherMonths":
      "Seçilen ayda birden fazla iş kaydı yok – uyarı, bu dönemin yukarıda listelenen diğer aylarından kaynaklanıyor.",
    "limit.multipleMinijobsForecastBasis":
      "Bu uyarı yalnızca seçilen aya kadarki 12 ayın kayıtlı girişlerine dayanır (geriye dönük). Bir tahmin ya da gelecekteki işler hakkında bir tespit değildir.",
    "limit.o4Uncertain":
      "Birden fazla iş durumu güvenilir şekilde belirlenemiyor",
    "limit.o4UncertainHint":
      "Ana işin yanında birden fazla Minijob'un aynı anda aktif olup olmadığı verilerden güvenilir şekilde belirlenemiyor: bazı hastalık veya tatil günlerinin ödemesi yalnızca tahmini (ör. haftalık plan veya işe başlama tarihi yok) ya da henüz bir onaya bağlı. Bu nedenle sınır durumu gösterilmez.",
    "limit.o4UncertainMonths":
      "Güvenilir şekilde belirlenemeyen aylar: {months}",
    "sick.linkCase":
      "{date} tarihinde başlayan hastalık vakasına ekle (yalnızca aynı hastalıksa). İşaretlenmezse gün ayrı sayılır.",
    "sick.ambiguousHelp":
      "Önceki hastalık dönemiyle sınır belirsiz. Eksik iş günlerinde de hastaysanız lütfen bunları hastalık günü olarak girin.",
    "pay.reason.sick-off-day": "Normal çalışma günü değil",
    "pay.reason.vacation-pay": "İzin ücreti",
    "pay.basis.average13": "13 hafta ortalaması",
    "pay.basis.plan": "Plana göre düzenli çalışma süresi",
    "pay.basis.entry": "Bu kaydın saatleri",
    "pay.absenceHours": "Devamsızlık saatleri (çalışılmadı)",
    "job.payroll": "Ödeme",
    "job.payrollSame": "Aynı ay",
    "job.payrollNext": "Sonraki ay",
    "job.notes": "Notlar",
    "job.tabPay": "Ücret",

    "set.defaults.hoursLimit": "Aylık saat sınırı",
    "set.limits.legalAuto": "Yasal minijob sınırını kullan",
    "set.limits.legalAutoHint": "Yasal asgari ücretten tarihe göre hesaplanır",
    "set.limits.legalSource": "Yasal sınır",
    "set.limits.auto": "Otomatik hesaplandı",
    "set.limits.formula": "Yıllık sınır = aylık sınır × 12",
    "set.limits.hoursAuto": "Saat sınırını otomatik hesapla",
    "set.limits.hoursAutoHint": "Aylık sınır ÷ saat ücreti",

    "notify.payday.title": "Ödeme günü",
    "notify.payday.body": "{job} için bugün yaklaşık {amount} bekleniyor.",
    "notify.limitHours.title": "Saat sınırı",
    "notify.limitHours.body": "Aylık saatlerinin %{percent} kadarını kullandın.",
  },
  pl: {
    "limit.title": "Limit minijob",
    "limit.earnings": "Wykorzystany zarobek",
    "limit.hours": "Wykorzystane godziny",
    "limit.leftAmount": "pozostało {amount}",
    "limit.leftHours": "pozostało {hours}",
    "limit.autoHint": "{hours} przy {rate}/godz.",
    "limit.month": "Miesiąc",
    "limit.year": "Rok",
    "limit.notApplicable": "Nie dotyczy (samozatrudnienie)",
    "limit.notApplicableHint": "Limit minijoba dla pracowników tutaj nie obowiązuje.",
    "limit.multipleMinijobs": "Kilka minijobów obok pracy głównej",
    "limit.multipleMinijobsHint":
      "Ta karta nie może poprawnie uwzględnić kilku minijobów obok pracy głównej, dlatego nie pokazuje statusu. Obok pracy głównej zwykle tylko pierwszy podjęty minijob pozostaje zwolniony; kolejne są sumowane z pracą główną. Sprawdź to (np. w Minijob-Zentrale lub kasie chorych).",
    "limit.multipleMinijobsSum": "Suma wszystkich minijobów (tylko informacyjnie): {amount}",
    "limit.multipleMinijobsMonths":
      "Dotyczy miesięcy (praca główna + co najmniej dwa minijoby aktywne w danym miesiącu): {months}",
    "limit.multipleMinijobsFilterNote":
      "Uwaga mimo filtra: sumy pokazują tylko wybraną pracę. To, czy limit można wiarygodnie ocenić, zależy od wszystkich równoległych zatrudnień – dlatego uwaga pozostaje.",
    "limit.overExplain": "Przekroczenie limitu może mieć znaczenie podatkowe i ubezpieczeniowe. Dokładne skutki zależą od Twojej sytuacji.",
    "limit.disclaimer": "To nie jest indywidualna porada podatkowa ani prawna. Aplikacja nie oblicza podatków ani składek.",

    "pay.title": "Dzień wypłaty",
    "pay.period": "Rozliczenie {month}",
    "pay.expected": "Oczekiwane",
    "pay.due": "Termin: {date}",
    "pay.actual": "Otrzymano",
    "pay.earned": "Zarobiono",
    "pay.paid": "Wypłacono",
    "pay.open": "Pozostało",
    "pay.overdue": "Płatność przeterminowana",
    "pay.enter": "Zapisz wypłatę",
    "pay.save": "Zapisz",
    "pay.saved": "Wypłata zapisana",
    "pay.diffPlus": "{amount} więcej niż oczekiwano",
    "pay.diffMinus": "{amount} mniej niż oczekiwano",
    "pay.diffOk": "Kwota się zgadza",
    "pay.none": "Brak rozliczenia w tym miesiącu.",
    "pay.add": "Dodaj płatność",
    "pay.edit": "Edytuj płatność",
    "pay.delete": "Usuń płatność",
    "pay.deleted": "Płatność usunięta",
    "pay.invalid": "Wpisz kwotę większą niż 0.",
    "pay.payments": "Płatności częściowe",
    "pay.overpaid": "Nadpłata",
    "pay.paymentDiff": "Zarobione − Wypłacone",

    "job.payday": "Dzień wypłaty (dzień miesiąca)",
    "job.startDate": "Początek zatrudnienia",
    "job.startDateHint":
      "Podstawa 4-tygodniowego okresu wyczekiwania na wynagrodzenie chorobowe (§ 3 EntgFG). Przed datą rozpoczęcia nie nalicza się godzin docelowych. Od daty rozpoczęcia obowiązują zwykłe zasady godzin docelowych.",
    "pay.absencePaid": "Płatna nieobecność",
    "pay.absenceUnpaid": "Bez wynagrodzenia",
    "pay.estimate": "Podstawa szacunkowa",
    "pay.reason.holiday-pay": "Święto w zwykły dzień pracy (§ 2 EntgFG)",
    "pay.reason.holiday-off-day": "Święto w dzień wolny – bez wypłaty",
    "pay.reason.sick-pay": "Wynagrodzenie chorobowe (§ 3 EntgFG)",
    "pay.reason.sick-waiting": "Okres 4 tygodni jeszcze nie minął",
    "pay.reason.sick-exceeded": "Przekroczono 6 tygodni na chorobę",
    "pay.notice.sick-case-ambiguous":
      "Niejasny przypadek choroby: sąsiednie wpisy nie zostały automatycznie połączone – sprawdź.",
    "pay.notice.sick-legacy-over-limit":
      "Rozbieżność wg zasady przypadku choroby (ponad 6 tygodni) – nie przeliczono automatycznie; przeliczenie tylko po potwierdzeniu.",
    "pay.notice.sick-case-long-gap":
      "Długa przerwa bez pracy między dniami choroby – możliwe dwie osobne choroby; liczone jako jeden przypadek, sprawdź.",
    "sickRecalc.title": "Zasada przypadku choroby: przeliczenie oczekuje",
    "sickRecalc.body":
      "W {count} mies. dni choroby różnią się wg zasady przypadku choroby (ponad 6 tygodni na domniemany przypadek). Bez Twojego potwierdzenia kwoty pozostają bez zmian.",
    "sickRecalc.review": "Sprawdź miesiące",
    "sickRecalc.hide": "Ukryj",
    "sickRecalc.row": "{days} dni choroby · obecnie {before} → nowe {after}",
    "sickRecalc.confirm": "Przelicz wybrane miesiące",
    "sickRecalc.cancel": "Anuluj",
    "sickRecalc.noneSelected": "Nie wybrano miesiąca – nic się nie zmieni.",
    "set.defaults.rateBelowMinimum":
      "Uwaga: od {date} Twoja domyślna stawka godzinowa jest niższa niż ustawowa płaca minimalna ({min}). Zapisane stawki nie są zmieniane automatycznie – w razie potrzeby zmień je samodzielnie.",
    "sickRecalc.reviewDays":
      "Sprawdź: {count} dzień/dni z niejasną granicą przypadku lub nietypowo długą przerwą.",
    "pay.notice.sick-case-possibly-separate":
      "Możliwie różne choroby: między tymi dniami choroby jest 6 lub więcej dni kalendarzowych bez choroby – nie są automatycznie łączone w jeden przypadek; ponowne przeliczenie tylko po Twoim potwierdzeniu.",
    "sickRecalc.separateDays":
      "Możliwie różne choroby: {count} dz. po przerwie 6 lub więcej dni kalendarzowych – sprawdź przed potwierdzeniem.",
    "retro.title":
      "Zmiana wpływa na inne wpisy",
    "retro.body":
      "Ta zmiana przelicza inaczej wpisy zapisane już w poniższych miesiącach. Bez potwierdzenia nic nie zostanie zapisane.",
    "retro.row":
      "dotychczas {before} → nowo {after}",
    "retro.lapsed":
      "Potwierdzone przeliczenie przypadku choroby zostanie cofnięte dla: {months}. Następnie sprawdź ponownie.",
    "retro.cancel":
      "Anuluj",
    "retro.confirm":
      "Zapisz mimo to",
    "retro.range":
      "Ten okres: wcześniej {daysBefore} dni, {before} → teraz {daysAfter} dni, {after}",
    "retro.rangeLost":
      "Te wpisy w okresie zostaną usunięte bez zastępstwa (dzień wolny wg obowiązującego planu): {days}",
    "absence.unchanged":
      "Bez zmian – okres pozostaje bez zmian.",
    "absence.unknownPlanSkipped":
      "Nie dodano {count} dni: plan pracy obowiązujący w te dni jest nieznany.",
    "sickLapsed.title":
      "Potwierdzenie cofnięte – sprawdź ponownie",
    "sickLapsed.body":
      "Dni choroby się zmieniły, dlatego Twoje wcześniejsze potwierdzenie przeliczenia nie obowiązuje już dla: {months}. Kwoty znów wynikają z niepotwierdzonego obliczenia.",
    "sickLapsed.dismiss":
      "Rozumiem",
    "limit.multipleMinijobsOtherMonths":
      "W wybranym miesiącu nie zapisano wielu zatrudnień – informacja wynika z innych miesięcy tego okresu wymienionych wyżej.",
    "limit.multipleMinijobsForecastBasis":
      "Ta informacja opiera się wyłącznie na zapisanych wpisach z 12 miesięcy do wybranego miesiąca (wstecz). Nie jest prognozą ani stwierdzeniem dotyczącym przyszłych zatrudnień.",
    "limit.o4Uncertain":
      "Wielokrotnego zatrudnienia nie można wiarygodnie ustalić",
    "limit.o4UncertainHint":
      "Na podstawie danych nie można wiarygodnie ustalić, czy obok głównego zatrudnienia kilka minijobów było aktywnych jednocześnie: wynagrodzenie za niektóre dni choroby lub święta jest tylko szacowane (np. brak planu tygodniowego lub daty rozpoczęcia zatrudnienia) albo zależy jeszcze od potwierdzenia. Dlatego status limitu nie jest wyświetlany.",
    "limit.o4UncertainMonths":
      "Nie można wiarygodnie ustalić w: {months}",
    "sick.linkCase":
      "Dodaj do przypadku choroby od {date} (tylko jeśli to ta sama choroba). Bez zaznaczenia dzień liczony jest osobno.",
    "sick.ambiguousHelp":
      "Granica z poprzednim okresem choroby jest niejasna. Jeśli w brakujące dni robocze też byłeś chory, wpisz je jako dni choroby.",
    "pay.reason.sick-off-day": "To nie jest zwykły dzień pracy",
    "pay.reason.vacation-pay": "Wynagrodzenie urlopowe",
    "pay.basis.average13": "Średnia z 13 tygodni",
    "pay.basis.plan": "Regularny czas pracy wg planu",
    "pay.basis.entry": "Godziny tego wpisu",
    "pay.absenceHours": "Godziny nieobecności (nieprzepracowane)",
    "job.payroll": "Wypłata",
    "job.payrollSame": "Ten sam miesiąc",
    "job.payrollNext": "Następny miesiąc",
    "job.notes": "Notatki",
    "job.tabPay": "Wypłata",

    "set.defaults.hoursLimit": "Limit godzin miesięcznie",
    "set.limits.legalAuto": "Uzyj ustawowego limitu minijob",
    "set.limits.legalAutoHint": "Wyliczany z ustawowej placy minimalnej na dany dzien",
    "set.limits.legalSource": "Limit ustawowy",
    "set.limits.auto": "Obliczone automatycznie",
    "set.limits.formula": "Limit roczny = miesięczny × 12",
    "set.limits.hoursAuto": "Automatycznie licz limit godzin",
    "set.limits.hoursAutoHint": "Z limitu miesięcznego ÷ stawka",

    "notify.payday.title": "Dzień wypłaty",
    "notify.payday.body": "Dziś dla {job} oczekiwane jest ok. {amount}.",
    "notify.limitHours.title": "Limit godzin",
    "notify.limitHours.body": "Wykorzystano {percent}% miesięcznych godzin.",
  },
};
