/**
 * Versionierte branchenspezifische Mindeststundenentgelte.
 *
 * Nur rechtsverbindlich festgesetzte Werte werden hinterlegt. Der allgemeine
 * gesetzliche Mindestlohn bleibt die Untergrenze; die effektive Untergrenze
 * ist max(allgemeiner Mindestlohn, Branchenmindestlohn).
 *
 * Quelle: BMAS, Übersicht Branchenmindestlöhne, Stand 30.09.2026.
 */
export interface IndustryMinimumWageGroup {
  id: string;
  label: string;
  /** Tätigkeitsbeschreibung zur Auswahlhilfe, keine automatische Einstufung. */
  description?: string;
  rates: { effectiveFrom: string; effectiveUntil?: string; hourlyRate: number }[];
}

export interface IndustryMinimumWageSector {
  id: string;
  label: string;
  source: string;
  effectiveUntil?: string;
  groups: IndustryMinimumWageGroup[];
}

export const INDUSTRY_MINIMUM_WAGE_SECTORS: IndustryMinimumWageSector[] = [
  {
    id: "gebaeudereinigung",
    label: "Gebäudereinigung",
    source: "10. GebäudeArbbV / TV Mindestlohn Gebäudereinigung",
    effectiveUntil: "2026-12-31",
    groups: [
      {
        id: "lg1",
        label: "Lohngruppe 1",
        description: "Innen- und Unterhaltsreinigung",
        rates: [
          { effectiveFrom: "2025-02-01", effectiveUntil: "2025-12-31", hourlyRate: 14.25 },
          { effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", hourlyRate: 15.0 },
        ],
      },
      {
        id: "lg6",
        label: "Lohngruppe 6",
        description: "Glas- und Fassadenreinigung",
        rates: [
          { effectiveFrom: "2025-02-01", effectiveUntil: "2025-12-31", hourlyRate: 17.65 },
          { effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", hourlyRate: 18.4 },
        ],
      },
    ],
  },
  {
    id: "dachdecker",
    label: "Dachdeckerhandwerk",
    source: "13. DachdArbbV",
    effectiveUntil: "2028-12-31",
    groups: [
      {
        id: "ungelernt",
        label: "Ungelernte Arbeitnehmer",
        rates: [{ effectiveFrom: "2026-01-01", effectiveUntil: "2028-12-31", hourlyRate: 14.96 }],
      },
      {
        id: "gelernt",
        label: "Gelernte Arbeitnehmer",
        rates: [
          { effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", hourlyRate: 16.6 },
          { effectiveFrom: "2027-01-01", effectiveUntil: "2027-12-31", hourlyRate: 17.1 },
          { effectiveFrom: "2028-01-01", effectiveUntil: "2028-12-31", hourlyRate: 17.6 },
        ],
      },
    ],
  },
  {
    id: "geruestbauer",
    label: "Gerüstbauerhandwerk",
    source: "9. GerüstbauerArbbV",
    effectiveUntil: "2027-12-31",
    groups: [
      {
        id: "gelernt",
        label: "Gelernte Arbeitnehmer",
        rates: [
          { effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", hourlyRate: 14.35 },
          { effectiveFrom: "2027-01-01", effectiveUntil: "2027-12-31", hourlyRate: 14.9 },
        ],
      },
    ],
  },
  {
    id: "maler-lackierer",
    label: "Maler- und Lackiererhandwerk",
    source: "12. MalerArbbV",
    effectiveUntil: "2027-06-30",
    groups: [
      {
        id: "gesellen",
        label: "Gelernte Arbeitnehmer (Gesellen/Gesellinnen)",
        rates: [
          { effectiveFrom: "2025-08-01", effectiveUntil: "2026-06-30", hourlyRate: 15.55 },
          { effectiveFrom: "2026-07-01", effectiveUntil: "2027-06-30", hourlyRate: 16.13 },
        ],
      },
    ],
  },
  {
    id: "pflege",
    label: "Pflegebranche",
    source: "7. PflegeArbbV",
    effectiveUntil: "2028-09-30",
    groups: [
      {
        id: "pflegekraft",
        label: "Pflegekraft",
        rates: [
          { effectiveFrom: "2026-07-01", effectiveUntil: "2027-06-30", hourlyRate: 16.1 },
          { effectiveFrom: "2027-07-01", effectiveUntil: "2028-06-30", hourlyRate: 16.52 },
          { effectiveFrom: "2028-07-01", effectiveUntil: "2028-09-30", hourlyRate: 16.95 },
        ],
      },
      {
        id: "pflegekraft-ausbildung",
        label: "Pflegekraft mit mindestens einjähriger Ausbildung",
        rates: [
          { effectiveFrom: "2026-07-01", effectiveUntil: "2027-06-30", hourlyRate: 17.35 },
          { effectiveFrom: "2027-07-01", effectiveUntil: "2028-06-30", hourlyRate: 17.8 },
          { effectiveFrom: "2028-07-01", effectiveUntil: "2028-09-30", hourlyRate: 18.26 },
        ],
      },
      {
        id: "pflegefachkraft",
        label: "Pflegefachkraft",
        rates: [
          { effectiveFrom: "2026-07-01", effectiveUntil: "2027-06-30", hourlyRate: 20.5 },
          { effectiveFrom: "2027-07-01", effectiveUntil: "2028-06-30", hourlyRate: 21.03 },
          { effectiveFrom: "2028-07-01", effectiveUntil: "2028-09-30", hourlyRate: 21.58 },
        ],
      },
    ],
  },
  {
    id: "elektrohandwerk",
    label: "Elektrohandwerke",
    source: "Allgemeinverbindlicherklärung, BAnz AT 30.12.2024 B3",
    effectiveUntil: "2028-12-31",
    groups: [
      {
        id: "standard",
        label: "Mindestlohn",
        rates: [
          { effectiveFrom: "2025-01-01", effectiveUntil: "2025-12-31", hourlyRate: 14.41 },
          { effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", hourlyRate: 14.93 },
          { effectiveFrom: "2027-01-01", effectiveUntil: "2027-12-31", hourlyRate: 15.49 },
          { effectiveFrom: "2028-01-01", effectiveUntil: "2028-12-31", hourlyRate: 16.1 },
        ],
      },
    ],
  },
];

function iso(date: string | Date): string {
  if (typeof date === "string") return date.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function findIndustrySector(id?: string): IndustryMinimumWageSector | undefined {
  return id ? INDUSTRY_MINIMUM_WAGE_SECTORS.find((s) => s.id === id) : undefined;
}

export function findIndustryGroup(
  sectorId?: string,
  groupId?: string,
): IndustryMinimumWageGroup | undefined {
  return findIndustrySector(sectorId)?.groups.find((g) => g.id === groupId);
}

export function industryMinimumWageFor(
  date: string | Date,
  sectorId?: string,
  groupId?: string,
): number | undefined {
  const target = iso(date);
  const group = findIndustryGroup(sectorId, groupId);
  if (!group) return undefined;
  let match: { effectiveFrom: string; effectiveUntil?: string; hourlyRate: number } | undefined;
  for (const rate of group.rates) {
    if (rate.effectiveFrom > target) continue;
    if (rate.effectiveUntil && rate.effectiveUntil < target) continue;
    if (!match || rate.effectiveFrom > match.effectiveFrom) match = rate;
  }
  return match?.hourlyRate;
}

/** Effektive gesetzliche Lohnuntergrenze einschließlich Branchenmindestlohn. */
export function bindingMinimumWageFor(
  date: string | Date,
  generalMinimumWage: number,
  sectorId?: string,
  groupId?: string,
): number {
  return Math.max(generalMinimumWage, industryMinimumWageFor(date, sectorId, groupId) ?? 0);
}
