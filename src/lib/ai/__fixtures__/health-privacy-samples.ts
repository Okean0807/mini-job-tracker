/**
 * FP/FN evaluation set for the L1 health privacy gate (R4).
 * `ideal` = desired decision. `residual` = known heuristic miss: the test pins
 * the CURRENT actual decision so any behaviour change is visible in review.
 * Test-only fixture; not imported by production code.
 */
export type GateSample = {
  id: string;
  text: string;
  lang: "de" | "en";
  ideal: "block" | "pass";
  /** Set only for documented residual FP/FN; value = current actual decision. */
  residualActual?: "block" | "pass";
  note?: string;
};

export const HEALTH_GATE_SAMPLES: GateSample[] = [
  // --- personal health disclosures (must block) ---
  { id: "P01", lang: "de", ideal: "block", text: "Ich bin seit Montag krank wegen einer Grippe, bekomme ich Lohnfortzahlung?" },
  { id: "P02", lang: "de", ideal: "block", text: "Meine Diagnose ist Depression, muss ich das meinem Minijob-Chef sagen?" },
  { id: "P03", lang: "de", ideal: "block", text: "AU wegen Bandscheibenvorfall bis Freitag – zahlt der Arbeitgeber?" },
  { id: "P04", lang: "de", ideal: "block", text: "Ich nehme Antidepressiva, darf ich trotzdem im Minijob arbeiten?" },
  { id: "P05", lang: "de", ideal: "block", text: "Ich bin schwanger, gilt der Mutterschutz auch für mich im Minijob?" },
  { id: "P06", lang: "de", ideal: "block", text: "Ich habe einen GdB von 50, wie viele Urlaubstage stehen mir zu?" },
  { id: "P07", lang: "de", ideal: "block", text: "Mein Arzt hat mich krankgeschrieben, wie melde ich das?" },
  { id: "P08", lang: "de", ideal: "block", text: "Ich mache gerade eine Psychotherapie wegen Burnout und kann nur 5 Stunden arbeiten." },
  { id: "P09", lang: "de", ideal: "block", text: "Mein Kind ist krank, bekomme ich Kinderkrankentage im Minijob?" },
  { id: "P10", lang: "de", ideal: "block", text: "Meine Kollegin ist schwanger und fällt aus, wer übernimmt ihre Schichten?" },
  { id: "P11", lang: "de", ideal: "block", text: "Ich war 3 Tage krank, werden die Stunden bezahlt?" },
  { id: "P12", lang: "de", ideal: "block", text: "Krankgeschrieben wegen Migräne, Diagnose G43.1 – was jetzt?" },
  { id: "P13", lang: "de", ideal: "block", text: "Ich hatte letzte Woche eine OP am Knie und bin noch in der Reha." },
  { id: "P14", lang: "de", ideal: "block", text: "Seit 2 Wochen Rückenschmerzen, darf mein Chef mich kündigen?" },
  { id: "P15", lang: "de", ideal: "block", text: "Notiz: Krankschreibung wegen Magen-Darm, Hausarzt Dr. Beispiel" },
  { id: "P16", lang: "de", ideal: "block", text: "Ich bin krank mit Fieber und kann morgen nicht zur Schicht." },
  { id: "P17", lang: "de", ideal: "block", text: "Bekomme ich Geld, weil ich seit Dienstag krankgeschrieben bin?" },
  { id: "P18", lang: "en", ideal: "block", text: "I am sick with the flu, do I still get paid for my minijob?" },
  { id: "P19", lang: "en", ideal: "block", text: "My doctor says I have anxiety, can I reduce my hours?" },
  { id: "P20", lang: "en", ideal: "block", text: "I was diagnosed with diabetes last month, must I tell my employer?" },
  { id: "P21", lang: "en", ideal: "block", text: "I'm pregnant – does maternity protection apply to my minijob?" },
  // --- general legal / payroll questions (must pass) ---
  { id: "G01", lang: "de", ideal: "pass", text: "Lohnfortzahlung im Krankheitsfall" },
  { id: "G02", lang: "de", ideal: "pass", text: "Wie viele Krankheitstage werden bezahlt?" },
  { id: "G03", lang: "de", ideal: "pass", text: "Krankenversicherung Minijob" },
  { id: "G04", lang: "de", ideal: "pass", text: "Was besagt die 6-Wochen-Regel bei der Entgeltfortzahlung?" },
  { id: "G05", lang: "de", ideal: "pass", text: "Bekommen Minijobber Lohnfortzahlung im Krankheitsfall?" },
  { id: "G06", lang: "de", ideal: "pass", text: "Muss ich als Minijobber eine AU vorlegen?" },
  { id: "G07", lang: "de", ideal: "pass", text: "Gilt der Mutterschutz auch im Minijob?" },
  { id: "G08", lang: "de", ideal: "pass", text: "Haben schwerbehinderte Minijobber Anspruch auf Zusatzurlaub?" },
  { id: "G09", lang: "de", ideal: "pass", text: "Wie hoch ist die Minijob-Grenze 2026?" },
  { id: "G10", lang: "de", ideal: "pass", text: "Wie viele Stunden darf ich bei 13,90 € Stundenlohn arbeiten?" },
  { id: "G11", lang: "de", ideal: "pass", text: "Wie viel habe ich diesen Monat verdient?" },
  { id: "G12", lang: "de", ideal: "pass", text: "Bin ich über der Jahresgrenze, wenn ich im Dezember mehr arbeite?" },
  { id: "G13", lang: "de", ideal: "pass", text: "Zahlt der Arbeitgeber bei Krankheit die Beiträge zur Rentenversicherung weiter?" },
  { id: "G14", lang: "de", ideal: "pass", text: "Was passiert mit meinem Urlaubsanspruch, wenn ich lange krank bin?", note: "hypothetical 'wenn ich … krank bin' is treated as general" },
  { id: "G15", lang: "de", ideal: "pass", text: "Muss ein Minijobber für Arzttermine Urlaub nehmen?" },
  { id: "G16", lang: "de", ideal: "pass", text: "Ich arbeite im Krankenhaus als Aushilfe – gilt dort der Mindestlohn?" },
  { id: "G17", lang: "de", ideal: "pass", text: "Meine Chefin sucht noch Aushilfen, kann ich zwei Minijobs haben?" },
  { id: "G18", lang: "en", ideal: "pass", text: "How many sick days are paid in a German minijob?" },
  { id: "G19", lang: "en", ideal: "pass", text: "Is health insurance mandatory for minijobs?" },
  { id: "G20", lang: "en", ideal: "pass", text: "What is the minijob earnings limit in 2026?" },
  // --- documented residual cases (heuristic limits) ---
  {
    id: "R01", lang: "de", ideal: "pass", residualActual: "block",
    text: "Muss ich bei einer Grippe sofort eine Krankmeldung abgeben?",
    note: "FP: hypothetical question with 'ich' + condition term is blocked (fail-safe)",
  },
  {
    id: "R02", lang: "de", ideal: "pass", residualActual: "block",
    text: "Ich arbeite in einer Physiotherapie-Praxis, zählt das als Minijob?",
    note: "FP: workplace name contains a treatment term + first person",
  },
  {
    id: "R03", lang: "de", ideal: "block", residualActual: "pass",
    text: "Bandscheibenvorfall – wie lange zahlt der Arbeitgeber?",
    note: "FN: bare condition without pronoun or time cue reads as general",
  },
  {
    id: "R04", lang: "de", ideal: "block", residualActual: "pass",
    text: "Hatte gestern einen Arbeitsunfall und mir tut die Hand weh.",
    note: "FN: colloquial symptom ('tut weh') not in lexicon; 'Arbeitsunfall' alone is a legal topic",
  },
  {
    id: "R05", lang: "en", ideal: "block", residualActual: "pass",
    text: "Feeling really depressed lately, can I take unpaid leave?",
    note: "FN: no pronoun, 'depressed' not in lexicon (only 'depression')",
  },
];
