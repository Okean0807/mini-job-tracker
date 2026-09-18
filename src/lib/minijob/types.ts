import type { Lang } from "@/lib/i18n/core";

export type { Lang };

export type WorkMode = "flex" | "fest" | "selbststaendig";

export type ShiftKind = "arbeit" | "urlaub" | "krank" | "feiertag";

export type SupplementMode = "prozent" | "fest";

export interface Supplement {
  enabled: boolean;
  mode: SupplementMode;
  /** Prozentwert (z. B. 25) oder fester Zuschlag pro Stunde in EUR */
  value: number;
}

export interface Supplements {
  saturday: Supplement;
  sunday: Supplement;
  holiday: Supplement;
  night: Supplement;
  overtime: Supplement;
  /** Nachtzuschlag ab (HH:mm) */
  nightStart: string;
  /** Nachtzuschlag bis (HH:mm) */
  nightEnd: string;
}

export const DEFAULT_SUPPLEMENTS: Supplements = {
  saturday: { enabled: false, mode: "prozent", value: 20 },
  sunday: { enabled: false, mode: "prozent", value: 50 },
  holiday: { enabled: false, mode: "prozent", value: 100 },
  night: { enabled: false, mode: "prozent", value: 25 },
  overtime: { enabled: false, mode: "prozent", value: 25 },
  nightStart: "23:00",
  nightEnd: "06:00",
};

/** Wochenplan für Festanstellung: Index 0 = Montag */
export interface FixedDay {
  active: boolean;
  start: string;
  end: string;
  breakMinutes: number;
}

export const EMPTY_WEEK: FixedDay[] = Array.from({ length: 7 }, (_, i) => ({
  active: i < 5,
  start: "09:00",
  end: "17:00",
  breakMinutes: 30,
}));

export interface Job {
  id: string;
  name: string;
  color: string;
  /** Stundenlohn in EUR; undefined = nicht gesetzt (Fallback auf Standardsatz), 0 = bewusst 0 EUR/h */
  rate?: number;
  mode: WorkMode;
  /** Beschäftigungsbeginn (ISO yyyy-MM-dd) – Basis der 4-Wochen-Wartezeit (§ 3 Abs. 3 EntgFG) */
  startDate?: string;
  employer?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Nur bei Festanstellung */
  week?: FixedDay[];
  /** Soll-Stunden pro Woche (Überstunden-Berechnung) */
  weeklyTarget?: number;
  supplements?: Supplements;
  notes?: string;
  /** Zahltag: Tag im Monat (1-31) */
  payday?: number;
  /** Abrechnungszeitraum: Auszahlung im selben Monat (0) oder im Folgemonat (1) */
  payrollDelay?: number;
  archived?: boolean;
}

/** Erfasste bzw. erwartete Lohnzahlung je Job und Abrechnungsmonat. */
export interface Payment {
  id: string;
  jobId: string;
  /** Abrechnungsjahr */
  year: number;
  /** Abrechnungsmonat (0-11) */
  month: number;
  /** Tatsächlich erhaltener Betrag */
  actual: number;
  /** Zahlungsdatum ISO */
  paidOn?: string;
  note?: string;
}

export interface Customer {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  rate?: number;
}

export interface Project {
  id: string;
  customerId: string;
  name: string;
  rate?: number;
}

export interface Shift {
  id: string;
  jobId?: string;
  kind: ShiftKind;
  /** ISO date yyyy-MM-dd */
  date: string;
  /** HH:mm */
  start: string;
  /** HH:mm */
  end: string;
  breakMinutes: number;
  /** Stundenlohn in EUR; undefined = nicht gesetzt (Fallback Job > Standard), 0 = bewusst 0 EUR/h */
  rate?: number;
  customerId?: string;
  projectId?: string;
  note?: string | undefined;
  /** Als Überstunden werten */
  overtime?: boolean;
  /** Leistungsnachweis: Einsatzort / Objekt */
  workplace?: string;
  /** Arbeitsnachweis: Straße */
  street?: string;
  /** Arbeitsnachweis: Hausnummer */
  houseNo?: string;
  /** Arbeitsnachweis: PLZ */
  zip?: string;
  /** Arbeitsnachweis: Ort */
  city?: string;
  /** Leistungsnachweis: Tätigkeiten ("#key" = Vorlage, sonst freier Text) */
  tasks?: string[];
  /** Leistungsnachweis: Fotos als komprimierte Data-URLs */
  photos?: string[];
  /** Leistungsnachweis: GPS-Standort */
  gps?: { lat: number; lng: number };
  /** Arbeitsnachweis: Etage (z. B. "3. OG") */
  floor?: string;
  /** Arbeitsnachweis: Türseite / Eingang (z. B. "linke Tür") */
  doorSide?: string;
  /** Arbeitsnachweis: Leistungsart (UR, FR, ER, BR, SR) */
  workCode?: string;
  /** Arbeitsnachweis: Freitext bei SR */
  workCodeNote?: string;
  /** Erfasst am (ISO date yyyy-MM-dd) */
  createdAt?: string;
}

/** Sparziel: automatisch aus Verdienst oder manuell gepflegt. */
export interface Goal {
  id: string;
  name: string;
  /** Zielbetrag in EUR */
  target: number;
  kind: "auto" | "manual";
  /** Nur bei kind = "manual": bereits angespart */
  manualSaved?: number;
  /** Nur bei kind = "auto": Anteil des Verdienstes in Prozent (Standard 100) */
  share?: number;
  /** Nur Verdienst dieses Jobs zählen */
  jobId?: string;
  /** Zählt ab diesem Datum (ISO) */
  from?: string;
  /** Frist (ISO) */
  deadline?: string;
  note?: string;
  icon?: string;
}

export type ThemeMode = "system" | "light" | "dark";
/** Oberflächen-Modus: Einfach, Standard, Profi */
export type UiMode = "simple" | "standard" | "pro";
/** Schriftgröße */
export type TextSize = "s" | "m" | "l" | "xl";
/** Bedienelement-Größe (Handschuh-Modus = extra groß) */
export type TouchSize = "normal" | "large" | "glove";
export type Accent = "teal" | "blue" | "green" | "orange" | "red" | "purple";

/** Dashboard-Widgets */
export type WidgetId =
  | "timer"
  | "stats"
  | "limitMonth"
  | "limitYear"
  | "payday"
  | "insights"
  | "calendar"
  | "goals"
  | "shifts";
export type WidgetSize = "small" | "medium" | "large";
export type DashboardLayout = "work" | "stats" | "compact";

export interface DashboardConfig {
  layout: DashboardLayout;
  order: WidgetId[];
  hidden: WidgetId[];
  pinned: WidgetId[];
  sizes: Partial<Record<WidgetId, WidgetSize>>;
}

export interface NotificationSettings {
  enabled: boolean;
  startReminder: boolean;
  startTime: string;
  endReminder: boolean;
  endTime: string;
  missingShift: boolean;
  backupReminder: boolean;
  limitAlerts: boolean;
  payday?: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: false,
  startReminder: true,
  startTime: "08:00",
  endReminder: true,
  endTime: "17:00",
  missingShift: true,
  backupReminder: true,
  limitAlerts: true,
  payday: true,
};

/** Frei definierbare Leistungsart. */
export interface WorkCodeDef {
  code: string;
  label: string;
}

export interface Settings {
  defaultRate: number;
  monthlyLimit: number;
  /**
   * Monatsgrenze automatisch aus der gesetzlichen Geringfügigkeitsgrenze
   * zum jeweiligen Stichtag ableiten (Standard). false = eigener Wert.
   */
  limitAuto: boolean;
  yearlyLimit: number;
  /** Stundengrenze pro Monat (manuell) */
  hoursLimitMonthly: number;
  /** Stundengrenze automatisch aus Monatsgrenze ÷ Stundenlohn berechnen */
  hoursLimitAuto: boolean;
  themeMode: ThemeMode;
  accent: Accent;
  uiMode: UiMode;
  textSize: TextSize;
  touchSize: TouchSize;
  highContrast: boolean;
  reduceMotion: boolean;
  country: string;
  bundesland: string;
  activeJobId?: string;
  supplements: Supplements;
  pinEnabled: boolean;
  pin?: string;
  biometric: boolean;
  /** base64url WebAuthn credential id for platform unlock; absent = not enrolled */
  biometricCredentialId?: string;
  autoBackup: boolean;
  language: Lang;
  /** Premium freigeschaltet (mehrere Jobs, KI, Cloud, Excel) */
  premium?: boolean;
  onboarded: boolean;
  /**
   * Epoch ms when the onboarding wizard finish() completed.
   * Distinguishes Skip-era / incomplete `onboarded:true` (no jobs, no stamp)
   * from a real finish — used by isWizardComplete.
   */
  wizardCompletedAt?: number;
  /**
   * Local demo/test mode: onboarding and Dashboard without Google.
   * Data stays on-device only; not a real cloud account.
   * Cleared when the user signs in with Google (exits demo).
   */
  localDemoMode?: boolean;

  /** Name für Arbeitsnachweis / Berichte */
  employeeName?: string;
  /** Eigene Leistungsarten (Code + Bezeichnung) */
  workCodes?: WorkCodeDef[];
  notifications: NotificationSettings;
  dashboard: DashboardConfig;
}

export interface RunningTimer {
  jobId?: string;
  startedAt: number;
  breakMinutes: number;
}

export interface AppData {
  shifts: Shift[];
  jobs: Job[];
  customers: Customer[];
  projects: Project[];
  payments: Payment[];
  goals: Goal[];
  settings: Settings;
  timer?: RunningTimer | null;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRate: 13.5,
  monthlyLimit: 556,
  limitAuto: true,
  yearlyLimit: 6672,
  hoursLimitMonthly: 0,
  hoursLimitAuto: false,
  themeMode: "system",
  accent: "teal",
  uiMode: "standard",
  textSize: "m",
  touchSize: "normal",
  highContrast: false,
  reduceMotion: false,
  country: "DE",
  bundesland: "NW",
  supplements: DEFAULT_SUPPLEMENTS,
  pinEnabled: false,
  biometric: false,
  autoBackup: true,
  language: "de",
  onboarded: false,
  localDemoMode: false,
  notifications: DEFAULT_NOTIFICATIONS,
  dashboard: {
    layout: "work",
    order: [
      "timer",
      "stats",
      "limitMonth",
      "limitYear",
      "payday",
      "insights",
      "goals",
      "calendar",
      "shifts",
    ],
    hidden: [],
    pinned: [],
    sizes: {},
  },
};

export const COUNTRIES: { code: string; name: string }[] = [
  { code: "DE", name: "Deutschland" },
  { code: "AT", name: "Österreich" },
  { code: "CH", name: "Schweiz" },
];

export const JOB_COLORS = [
  "#0d9488",
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#0891b2",
];

export const BUNDESLAENDER: { code: string; name: string }[] = [
  { code: "BW", name: "Baden-Württemberg" },
  { code: "BY", name: "Bayern" },
  { code: "BE", name: "Berlin" },
  { code: "BB", name: "Brandenburg" },
  { code: "HB", name: "Bremen" },
  { code: "HH", name: "Hamburg" },
  { code: "HE", name: "Hessen" },
  { code: "MV", name: "Mecklenburg-Vorpommern" },
  { code: "NI", name: "Niedersachsen" },
  { code: "NW", name: "Nordrhein-Westfalen" },
  { code: "RP", name: "Rheinland-Pfalz" },
  { code: "SL", name: "Saarland" },
  { code: "SN", name: "Sachsen" },
  { code: "ST", name: "Sachsen-Anhalt" },
  { code: "SH", name: "Schleswig-Holstein" },
  { code: "TH", name: "Thüringen" },
];

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  flex: "Flexibler Zeitplan",
  fest: "Fester Arbeitsplan",
  selbststaendig: "Selbstständig",
};

export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = {
  arbeit: "Arbeit",
  urlaub: "Urlaub",
  krank: "Krank",
  feiertag: "Feiertag",
};
