export interface Shift {
  id: string;
  /** ISO date yyyy-MM-dd */
  date: string;
  /** HH:mm */
  start: string;
  /** HH:mm */
  end: string;
  breakMinutes: number;
  /** Stundenlohn in EUR */
  rate: number;
  note?: string | undefined;
}

export interface Settings {
  defaultRate: number;
  monthlyLimit: number;
  theme: "light" | "dark";
}

export interface AppData {
  shifts: Shift[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRate: 13.5,
  monthlyLimit: 556,
  theme: "light",
};
