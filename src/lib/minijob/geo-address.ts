/**
 * Reverse-geocode helpers for German addresses (Nominatim/OSM).
 *
 * Invariant: never write raw lat/lng into street/houseNo/zip/city when reverse
 * geocode fails or is too inaccurate — GPS stays in `shift.gps` only.
 */

export interface GermanAddress {
  street?: string;
  houseNo?: string;
  zip?: string;
  city?: string;
}

/** Subset of Nominatim `address` we care about. */
export interface NominatimAddressParts {
  road?: string;
  pedestrian?: string;
  path?: string;
  footway?: string;
  residential?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  city_district?: string;
}

export interface NominatimReverseResult {
  address?: NominatimAddressParts;
  display_name?: string;
  error?: string;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const REVERSE_TIMEOUT_MS = 8_000;

function pickStreet(parts: NominatimAddressParts): string | undefined {
  const raw =
    parts.road ||
    parts.pedestrian ||
    parts.path ||
    parts.footway ||
    parts.residential ||
    undefined;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

function pickCity(parts: NominatimAddressParts): string | undefined {
  const raw =
    parts.city ||
    parts.town ||
    parts.village ||
    parts.municipality ||
    parts.suburb ||
    parts.city_district ||
    undefined;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

/** Pure mapper: Nominatim address object → editable German fields. */
export function mapNominatimToGermanAddress(
  result: NominatimReverseResult | null | undefined,
): GermanAddress | null {
  if (!result || result.error || !result.address) return null;
  const parts = result.address;
  const street = pickStreet(parts);
  const houseNo = parts.house_number?.trim() || undefined;
  const zip = parts.postcode?.trim() || undefined;
  const city = pickCity(parts);

  const mapped: GermanAddress = {};
  if (street) mapped.street = street;
  if (houseNo) mapped.houseNo = houseNo;
  if (zip) mapped.zip = zip;
  if (city) mapped.city = city;

  return isUsableGermanAddress(mapped) ? mapped : null;
}

/**
 * Usable when we have a street name, or both PLZ and city.
 * Rejects empty / coord-like junk (digits-only "street" that looks like lat).
 */
export function isUsableGermanAddress(addr: GermanAddress | null | undefined): boolean {
  if (!addr) return false;
  const street = addr.street?.trim() ?? "";
  const zip = addr.zip?.trim() ?? "";
  const city = addr.city?.trim() ?? "";
  if (looksLikeCoordinates(street) || looksLikeCoordinates(city)) return false;
  if (street.length >= 2) return true;
  return zip.length >= 4 && city.length >= 2;
}

/** Detect "52.52000, 13.40500" style strings so we never save them as street. */
export function looksLikeCoordinates(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^-?\d{1,3}([.,]\d+)?\s*,\s*-?\d{1,3}([.,]\d+)?$/.test(v);
}

/** Human-readable DE line: „Musterstraße 15, 12345 Berlin“. */
export function formatGermanAddress(addr: GermanAddress): string {
  const line1 = [addr.street?.trim(), addr.houseNo?.trim()].filter(Boolean).join(" ");
  const line2 = [addr.zip?.trim(), addr.city?.trim()].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}

/**
 * Reverse-geocode via Nominatim. Returns null on network/timeout/unusable
 * result — caller must keep GPS separate and leave address fields untouched
 * (or only clear on explicit user action).
 */
export async function reverseGeocodeGerman(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GermanAddress | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "de");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVERSE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        // Nominatim usage policy: identify the application.
        "User-Agent": "MiniJobCompanion/1.0 (UX reverse-geocode; local app)",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as NominatimReverseResult;
    return mapNominatimToGermanAddress(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Apply reverse result onto editable address fields without ever injecting
 * coordinates. Returns the previous address unchanged when reverse fails.
 */
export function applyReverseOrKeep(
  previous: GermanAddress,
  reverse: GermanAddress | null,
): GermanAddress {
  if (!reverse || !isUsableGermanAddress(reverse)) return previous;
  const next: GermanAddress = {};
  const street = reverse.street ?? previous.street;
  const houseNo = reverse.houseNo ?? previous.houseNo;
  const zip = reverse.zip ?? previous.zip;
  const city = reverse.city ?? previous.city;
  if (street) next.street = street;
  if (houseNo) next.houseNo = houseNo;
  if (zip) next.zip = zip;
  if (city) next.city = city;
  return next;
}
