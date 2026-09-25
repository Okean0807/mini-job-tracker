import { scopedKey, type StorageScope } from "./storage-scope";
import { getActiveScope } from "./store";

/**
 * Local registry of app-generated exports (PDF/XLSX/Arbeitsnachweis).
 * Keeps cloud upload schema untouched; stores blobs in localStorage when small enough.
 */
export const GENERATED_DOC_CATEGORIES = [
  "arbeitsnachweis",
  "report_pdf",
  "report_xlsx",
  "worklog",
  "annual_pdf",
  "annual_xlsx",
] as const;

export type GeneratedDocCategory = (typeof GENERATED_DOC_CATEGORIES)[number];

export interface GeneratedDocument {
  id: string;
  name: string;
  category: GeneratedDocCategory;
  mimeType: string;
  size: number;
  createdAt: string;
  /** data: URL; empty when payload was too large to persist */
  dataUrl: string;
  source: "generated";
}

/**
 * Basis-Schlüssel; gespeichert wird pro Scope (Konto / Testmodus / Gast), da die
 * data-URLs Namen und Adressen enthalten. Der globale Schlüssel ohne Suffix ist
 * Legacy und wird nur über den expliziten Import gelesen.
 */
export const GENERATED_DOCS_KEY_BASE = "minijob-generated-docs-v1";

export function generatedDocsStorageKey(scope: StorageScope = getActiveScope()): string {
  return scopedKey(GENERATED_DOCS_KEY_BASE, scope);
}
const MAX_ENTRIES = 40;
/** Skip persisting payload above this size (metadata still kept). */
const MAX_DATA_URL_CHARS = 1_800_000;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAll(key: string = generatedDocsStorageKey()): GeneratedDocument[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is GeneratedDocument => {
        if (!row || typeof row !== "object") return false;
        const d = row as GeneratedDocument;
        return (
          typeof d.id === "string" &&
          typeof d.name === "string" &&
          typeof d.category === "string" &&
          typeof d.mimeType === "string" &&
          typeof d.size === "number" &&
          typeof d.createdAt === "string" &&
          typeof d.dataUrl === "string" &&
          d.source === "generated"
        );
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

function writeAll(docs: GeneratedDocument[], key: string = generatedDocsStorageKey()): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(docs.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota — drop payloads and retry metadata-only */
    try {
      const slim = docs.slice(0, MAX_ENTRIES).map((d) => ({ ...d, dataUrl: "" }));
      window.localStorage.setItem(key, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

export function listGeneratedDocuments(): GeneratedDocument[] {
  return readAll();
}

export function getGeneratedDocument(id: string): GeneratedDocument | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function isGeneratedDocCategory(value: string): value is GeneratedDocCategory {
  return (GENERATED_DOC_CATEGORIES as readonly string[]).includes(value);
}

export function registerGeneratedDocument(input: {
  name: string;
  category: GeneratedDocCategory;
  mimeType: string;
  size: number;
  dataUrl?: string;
  createdAt?: string;
}): GeneratedDocument {
  const dataUrl =
    typeof input.dataUrl === "string" && input.dataUrl.length <= MAX_DATA_URL_CHARS
      ? input.dataUrl
      : "";
  const doc: GeneratedDocument = {
    id: `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.slice(0, 180),
    category: input.category,
    mimeType: input.mimeType,
    size: Math.max(0, input.size),
    createdAt: input.createdAt ?? new Date().toISOString(),
    dataUrl,
    source: "generated",
  };
  const next = [doc, ...readAll().filter((d) => d.id !== doc.id)].slice(0, MAX_ENTRIES);
  writeAll(next);
  return doc;
}

export function deleteGeneratedDocument(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

/** Clear registry of the active scope (tests). */
export function clearGeneratedDocuments(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(generatedDocsStorageKey());
}

/** Dokumente unter einem beliebigen Schlüssel lesen (Legacy / anderer Scope, nur für Import). */
export function readGeneratedDocumentsAt(key: string): GeneratedDocument[] {
  return readAll(key);
}

/**
 * Explizit übernommene Dokumente in den aktiven Scope mischen (Id-Duplikate
 * werden übersprungen). Die Quelle bleibt unverändert.
 */
export function importGeneratedDocuments(docs: GeneratedDocument[]): number {
  if (docs.length === 0) return 0;
  const current = readAll();
  const known = new Set(current.map((d) => d.id));
  const added = docs.filter((d) => !known.has(d.id));
  if (added.length === 0) return 0;
  const merged = [...current, ...added].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  writeAll(merged);
  return added.length;
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mimeMatch = /^data:([^;]+)/.exec(header);
  const mime = mimeMatch?.[1] ?? "application/octet-stream";
  try {
    if (header.includes(";base64")) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(data)], { type: mime });
  } catch {
    return null;
  }
}

export function openGeneratedDocument(doc: GeneratedDocument): boolean {
  if (!doc.dataUrl) return false;
  const blob = dataUrlToBlob(doc.dataUrl);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function downloadGeneratedDocument(doc: GeneratedDocument): boolean {
  if (!doc.dataUrl) return false;
  const blob = dataUrlToBlob(doc.dataUrl);
  if (!blob) return false;
  triggerBlobDownload(blob, doc.name);
  return true;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
    reader.readAsDataURL(blob);
  });
}

/** Download a blob and register it in the local Dokumente hub. */
export async function saveAndRegisterExport(opts: {
  blob: Blob;
  filename: string;
  category: GeneratedDocCategory;
  mimeType?: string;
}): Promise<GeneratedDocument> {
  const mimeType = opts.mimeType ?? (opts.blob.type || "application/octet-stream");
  triggerBlobDownload(opts.blob, opts.filename);
  let dataUrl = "";
  try {
    dataUrl = await blobToDataUrl(opts.blob);
  } catch {
    dataUrl = "";
  }
  return registerGeneratedDocument({
    name: opts.filename,
    category: opts.category,
    mimeType,
    size: opts.blob.size,
    dataUrl,
  });
}

/** Sync base64 data URL from bytes (for PDF/XLSX exporters). */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  if (bytes.byteLength === 0) return "";
  // Avoid huge strings in localStorage
  if (bytes.byteLength * 1.37 > MAX_DATA_URL_CHARS) return "";
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Sync: download + register from ArrayBuffer / Uint8Array. */
export function saveAndRegisterBytes(opts: {
  bytes: ArrayBuffer | Uint8Array;
  filename: string;
  category: GeneratedDocCategory;
  mimeType: string;
}): GeneratedDocument {
  const bytes = opts.bytes instanceof Uint8Array ? opts.bytes : new Uint8Array(opts.bytes);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: opts.mimeType });
  triggerBlobDownload(blob, opts.filename);
  return registerGeneratedDocument({
    name: opts.filename,
    category: opts.category,
    mimeType: opts.mimeType,
    size: bytes.byteLength,
    dataUrl: bytesToDataUrl(bytes, opts.mimeType),
  });
}
