import type { Shift, WorkObject } from "./types";

/** Kalender-Default für neue Einträge; bestehende behalten ihr Datum. */
export function resolveEntryDate(
  shift: Pick<Shift, "date"> | null | undefined,
  calendarDate: string,
): string {
  return shift?.date ?? calendarDate;
}

/** Formularfelder, die beim Auswählen eines Objekts übernommen werden. */
export interface ObjectFormFields {
  objectId: string;
  workplace: string;
  street: string;
  houseNo: string;
  floor: string;
  doorSide: string;
  zip: string;
  city: string;
}

/** Objekt → Formularfelder (Adresse + optional workplace=name). */
export function applyObjectToFormFields(obj: WorkObject): ObjectFormFields {
  return {
    objectId: obj.id,
    workplace: obj.name ?? "",
    street: obj.street ?? "",
    houseNo: obj.houseNo ?? "",
    floor: obj.floor ?? "",
    doorSide: obj.doorSide ?? "",
    zip: obj.zip ?? "",
    city: obj.city ?? "",
  };
}

/** Kurze Adressvorschau für Dropdown/Liste. */
export function objectAddressPreview(obj: Pick<WorkObject, "street" | "houseNo" | "zip" | "city" | "floor" | "doorSide">): string {
  const street = [obj.street, obj.houseNo]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const line1 = [street, (obj.floor ?? "").trim(), (obj.doorSide ?? "").trim()]
    .filter(Boolean)
    .join(", ");
  const line2 = [obj.zip, obj.city]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return [line1, line2].filter(Boolean).join(" · ");
}

/** Shift-Save: schreibt entryDate als date (kein Duplikat bei id-erhaltendem upsert). */
export function withEntryDate<T extends { date: string }>(payload: T, entryDate: string): T {
  return { ...payload, date: entryDate };
}
