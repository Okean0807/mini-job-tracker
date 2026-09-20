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
export function objectAddressPreview(
  obj: Pick<WorkObject, "street" | "houseNo" | "zip" | "city" | "floor" | "doorSide">,
): string {
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

/* -------------------------------------------------------------------------- */
/* Auto-learning: Adresse → WorkObject (konservatives Upsert)                 */
/* -------------------------------------------------------------------------- */

/** Felder, die die Primäradresse bilden (Identität). */
export type PrimaryAddressFields = {
  street?: string | undefined;
  houseNo?: string | undefined;
  zip?: string | undefined;
  city?: string | undefined;
};

/** Adresse inkl. optionaler Extras (Etage/Türseite) und Namenshinweis. */
export type ShiftAddressSource = PrimaryAddressFields & {
  floor?: string | undefined;
  doorSide?: string | undefined;
  workplace?: string | undefined;
};

/**
 * Normalisierung NUR für Vergleich: trim, Mehrfach-Spaces → ein Space, case-insensitive.
 * Keine Synonym-Merge, kein Umlaut-Folding.
 */
export function normalizeCompareValue(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Primärschlüssel aus Straße/Hausnr/PLZ/Ort (normalisiert). Leer wenn keine Adresse. */
export function normalizePrimaryKey(parts: PrimaryAddressFields): string | null {
  const street = normalizeCompareValue(parts.street);
  const houseNo = normalizeCompareValue(parts.houseNo);
  const zip = normalizeCompareValue(parts.zip);
  const city = normalizeCompareValue(parts.city);
  if (!street && !houseNo && !zip && !city) return null;
  return `${street}|${houseNo}|${zip}|${city}`;
}

/** True wenn genug Adresse vorhanden ist, um ein Objekt zu lernen. */
export function hasLearnableAddress(parts: PrimaryAddressFields): boolean {
  return normalizePrimaryKey(parts) !== null;
}

/** Findet ein Objekt mit gleicher Primäradresse (floor/doorSide ignoriert). */
export function findMatchingObject(
  objects: readonly WorkObject[],
  parts: PrimaryAddressFields,
): WorkObject | undefined {
  const key = normalizePrimaryKey(parts);
  if (!key) return undefined;
  return objects.find((o) => normalizePrimaryKey(o) === key);
}

function trimOrEmpty(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/**
 * Konservativ: leere Objekt-Felder aus Quelle füllen.
 * Nie nicht-leere Felder mit abweichenden Werten überschreiben.
 * Gibt undefined zurück wenn nichts geändert wurde.
 */
function fillIfEmpty(
  current: string | undefined,
  incomingRaw: string | undefined,
): string | undefined {
  const incoming = trimOrEmpty(incomingRaw);
  if (!incoming) return undefined;
  if (trimOrEmpty(current)) return undefined; // nicht überschreiben
  return incoming;
}

export function conservativeFillObject(
  existing: WorkObject,
  source: ShiftAddressSource,
  now?: string,
): WorkObject | undefined {
  const patch: Partial<WorkObject> = {};

  const street = fillIfEmpty(existing.street, source.street);
  if (street !== undefined) patch.street = street;
  const houseNo = fillIfEmpty(existing.houseNo, source.houseNo);
  if (houseNo !== undefined) patch.houseNo = houseNo;
  const zip = fillIfEmpty(existing.zip, source.zip);
  if (zip !== undefined) patch.zip = zip;
  const city = fillIfEmpty(existing.city, source.city);
  if (city !== undefined) patch.city = city;
  const floor = fillIfEmpty(existing.floor, source.floor);
  if (floor !== undefined) patch.floor = floor;
  const doorSide = fillIfEmpty(existing.doorSide, source.doorSide);
  if (doorSide !== undefined) patch.doorSide = doorSide;

  const workplace = trimOrEmpty(source.workplace);
  if (workplace && !trimOrEmpty(existing.name)) {
    patch.name = workplace;
  }

  if (Object.keys(patch).length === 0) return undefined;
  const next: WorkObject = { ...existing, ...patch };
  if (now) next.updatedAt = now;
  return next;
}

/** Anzeigename für neu gelerntes Objekt. */
export function defaultObjectName(source: ShiftAddressSource): string {
  const workplace = trimOrEmpty(source.workplace);
  if (workplace) return workplace;
  const street = [trimOrEmpty(source.street), trimOrEmpty(source.houseNo)].filter(Boolean).join(" ");
  if (street) return street;
  const locality = [trimOrEmpty(source.zip), trimOrEmpty(source.city)].filter(Boolean).join(" ");
  if (locality) return locality;
  return "Objekt";
}

export interface UpsertObjectResult {
  /** Objekte-Liste (gleiche Referenz wenn unverändert). */
  objects: WorkObject[];
  /** Id des gematchten/erstellten Objekts (undefined wenn keine lernbare Adresse). */
  objectId: string | undefined;
  created: boolean;
  updated: boolean;
}

export interface UpsertObjectOptions {
  newId: () => string;
  /** ISO-Datum yyyy-MM-dd für createdAt/updatedAt */
  now?: string;
}

/**
 * Lernt/aktualisiert ein WorkObject aus Schicht-Adressfeldern.
 * - Neue Primäradresse → neues Objekt
 * - Match → nur fehlende Felder füllen (nie overwrite)
 * - floor/doorSide erzeugen kein neues Objekt bei gleichem Primärschlüssel
 */
export function upsertObjectFromShiftAddress(
  objects: readonly WorkObject[],
  source: ShiftAddressSource,
  options: UpsertObjectOptions,
): UpsertObjectResult {
  if (!hasLearnableAddress(source)) {
    return { objects: objects as WorkObject[], objectId: undefined, created: false, updated: false };
  }

  const now = options.now;
  const match = findMatchingObject(objects, source);
  if (match) {
    const filled = conservativeFillObject(match, source, now);
    if (!filled) {
      return {
        objects: objects as WorkObject[],
        objectId: match.id,
        created: false,
        updated: false,
      };
    }
    const next = objects.map((o) => (o.id === match.id ? filled : o));
    return { objects: next, objectId: match.id, created: false, updated: true };
  }

  const created: WorkObject = {
    id: options.newId(),
    name: defaultObjectName(source),
  };
  if (now) {
    created.createdAt = now;
    created.updatedAt = now;
  }
  const street = trimOrEmpty(source.street);
  const houseNo = trimOrEmpty(source.houseNo);
  const zip = trimOrEmpty(source.zip);
  const city = trimOrEmpty(source.city);
  const floor = trimOrEmpty(source.floor);
  const doorSide = trimOrEmpty(source.doorSide);
  if (street) created.street = street;
  if (houseNo) created.houseNo = houseNo;
  if (zip) created.zip = zip;
  if (city) created.city = city;
  if (floor) created.floor = floor;
  if (doorSide) created.doorSide = doorSide;

  return {
    objects: [...objects, created],
    objectId: created.id,
    created: true,
    updated: false,
  };
}

/**
 * Einmalig beim Hydrate/Import: fehlende Objekte aus bestehenden Schichten anlegen.
 * Nur ADD + konservatives Fill — Schichten werden NICHT mutiert.
 *
 * Design-Wahl (Brief §7): upsert-on-shift-save ist der Hauptpfad; zusätzlich
 * ensureObjectsFromShifts beim Laden/Import, damit Legacy-Adressen in der
 * Objektliste erscheinen ohne destruktive Migration.
 */
export function ensureObjectsFromShifts(
  objects: readonly WorkObject[],
  shifts: readonly ShiftAddressSource[],
  options: UpsertObjectOptions,
): WorkObject[] {
  let next = objects as WorkObject[];
  let changed = false;
  for (const shift of shifts) {
    const result = upsertObjectFromShiftAddress(next, shift, options);
    if (result.created || result.updated) {
      next = result.objects;
      changed = true;
    } else if (result.objects !== next) {
      next = result.objects;
    }
  }
  return changed ? next : (objects as WorkObject[]);
}

/**
 * Schicht mit objectId verknüpfen (ohne Adressfelder der Schicht zu ändern).
 * exactOptionalPropertyTypes-sicher.
 */
export function linkShiftToObject(shift: Shift, objectId: string | undefined): Shift {
  if (!objectId) return shift;
  if (shift.objectId === objectId) return shift;
  return { ...shift, objectId };
}

/** objectId von Schichten entfernen, Adressfelder behalten. */
export function clearObjectIdFromShifts(shifts: readonly Shift[], objectId: string): Shift[] {
  return shifts.map((s) => {
    if (s.objectId !== objectId) return s;
    const { objectId: _drop, ...rest } = s;
    return rest as Shift;
  });
}
