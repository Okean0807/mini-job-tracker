/**
 * Minimal ZIP container (PKZIP "stored" entries only, no compression, no encryption, no ZIP64).
 *
 * Why not a library: the project may not add dependencies for this phase, and backups only carry
 * already-compressed files (PDF/JPEG/PNG/WebP) plus small JSON. The reader is deliberately strict:
 * it refuses anything it does not fully understand (compressed/encrypted/ZIP64/multi-disk entries,
 * duplicate names, names outside a safe alphabet, sizes that do not add up, CRC mismatches).
 * CRC-32 is the standard ZIP integrity check against corruption; it is NOT a security feature and the
 * backup is NOT encrypted.
 */
export class ZipError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ZipError";
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1)
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

export const MAX_ZIP_ENTRIES = 2000;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

export type ZipInputEntry = { name: string; data: Blob };
export type ZipEntryInfo = { name: string; size: number; crc: number; offset: number };

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}
function u32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}
const enc = new TextEncoder();

/** Fixed DOS date/time (1980-01-01) so identical input always yields byte-identical archives. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export async function crcOfBlob(blob: Blob): Promise<number> {
  return crc32(new Uint8Array(await blob.arrayBuffer()));
}

/** Builds a ZIP as a Blob; entry data are referenced as Blob parts (not copied into one buffer). */
export async function buildZip(entries: ZipInputEntry[]): Promise<Blob> {
  if (entries.length > MAX_ZIP_ENTRIES) throw new ZipError("too-many-entries");
  const seen = new Set<string>();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    if (
      !SAFE_NAME.test(e.name) ||
      e.name.includes("//") ||
      e.name.includes("..") ||
      seen.has(e.name)
    ) {
      throw new ZipError("bad-entry-name");
    }
    seen.add(e.name);
    const name = enc.encode(e.name);
    const crc = await crcOfBlob(e.data);
    const size = e.data.size;
    if (size >= 0xffffffff) throw new ZipError("entry-too-large");
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(size),
      u32(size),
      u16(name.length),
      u16(0),
      name,
    ]);
    parts.push(local as BlobPart, e.data);
    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(size),
        u32(size),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length + size;
  }
  const cd = concat(central);
  if (offset + cd.length >= 0xffffffff) throw new ZipError("archive-too-large");
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  ]);
  parts.push(cd as BlobPart, eocd as BlobPart);
  return new Blob(parts, { type: "application/zip" });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function looksLikeZip(head: Uint8Array): boolean {
  return (
    head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  );
}

export type ZipReadLimits = { maxEntryBytes: number; maxTotalBytes: number };

export type ZipArchive = {
  entries: ZipEntryInfo[];
  /** Reads one entry, verifies its size and CRC-32 and returns the bytes as a Blob (typed as given). */
  read(name: string, type?: string): Promise<Blob>;
};

/**
 * Opens an archive. Only the central directory is read here; entry bytes are read (and CRC-checked) by
 * `read()`. Throws ZipError("corrupt" | "unsupported" | ...) for anything unexpected.
 */
export async function openZip(file: Blob, limits: ZipReadLimits): Promise<ZipArchive> {
  if (file.size < 22) throw new ZipError("corrupt");
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
  let eocdAt = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) throw new ZipError("corrupt");
  const dv = new DataView(tail.buffer, tail.byteOffset + eocdAt, 22);
  const disk = dv.getUint16(4, true),
    cdDisk = dv.getUint16(6, true);
  const countDisk = dv.getUint16(8, true),
    count = dv.getUint16(10, true);
  const cdSize = dv.getUint32(12, true),
    cdOffset = dv.getUint32(16, true),
    commentLen = dv.getUint16(20, true);
  if (disk !== 0 || cdDisk !== 0 || countDisk !== count) throw new ZipError("unsupported");
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ZipError("unsupported");
  if (eocdAt + 22 + commentLen !== tail.length) throw new ZipError("corrupt");
  if (count > MAX_ZIP_ENTRIES) throw new ZipError("too-many-entries");
  if (cdOffset + cdSize > file.size - 22) throw new ZipError("corrupt");

  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.length);
  const dec = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntryInfo[] = [];
  const names = new Set<string>();
  let pos = 0;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > cd.length || cdv.getUint32(pos, true) !== 0x02014b50)
      throw new ZipError("corrupt");
    const flags = cdv.getUint16(pos + 8, true),
      method = cdv.getUint16(pos + 10, true);
    const crc = cdv.getUint32(pos + 16, true),
      csize = cdv.getUint32(pos + 20, true),
      usize = cdv.getUint32(pos + 24, true);
    const nlen = cdv.getUint16(pos + 28, true),
      xlen = cdv.getUint16(pos + 30, true),
      clen = cdv.getUint16(pos + 32, true);
    const diskNo = cdv.getUint16(pos + 34, true),
      offset = cdv.getUint32(pos + 42, true);
    if (pos + 46 + nlen + xlen + clen > cd.length) throw new ZipError("corrupt");
    if ((flags & 0x0001) !== 0) throw new ZipError("unsupported"); // encrypted
    if ((flags & 0x0008) !== 0) throw new ZipError("unsupported"); // sizes in data descriptor
    if (method !== 0) throw new ZipError("unsupported"); // compressed
    if (diskNo !== 0 || csize !== usize || csize === 0xffffffff || offset === 0xffffffff)
      throw new ZipError("unsupported");
    let name: string;
    try {
      name = dec.decode(cd.subarray(pos + 46, pos + 46 + nlen));
    } catch {
      throw new ZipError("corrupt");
    }
    if (!SAFE_NAME.test(name) || name.includes("//") || name.includes("..") || name.endsWith("/"))
      throw new ZipError("bad-entry-name");
    if (names.has(name)) throw new ZipError("duplicate-entry");
    names.add(name);
    if (usize > limits.maxEntryBytes) throw new ZipError("entry-too-large");
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError("archive-too-large");
    if (offset + 30 + nlen + usize > cdOffset) throw new ZipError("corrupt");
    entries.push({ name, size: usize, crc, offset });
    pos += 46 + nlen + xlen + clen;
  }
  if (pos !== cd.length) throw new ZipError("corrupt");

  return {
    entries,
    async read(name: string, type = "application/octet-stream"): Promise<Blob> {
      const info = entries.find((e) => e.name === name);
      if (!info) throw new ZipError("missing-entry");
      const head = new Uint8Array(await file.slice(info.offset, info.offset + 30).arrayBuffer());
      const hv = new DataView(head.buffer, head.byteOffset, head.length);
      if (head.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new ZipError("corrupt");
      const lflags = hv.getUint16(6, true),
        lmethod = hv.getUint16(8, true);
      const lcrc = hv.getUint32(14, true),
        lsize = hv.getUint32(22, true);
      const lnlen = hv.getUint16(26, true),
        lxlen = hv.getUint16(28, true);
      if ((lflags & 0x0009) !== 0 || lmethod !== 0 || lsize !== info.size || lcrc !== info.crc)
        throw new ZipError("corrupt");
      const start = info.offset + 30 + lnlen + lxlen;
      if (start + info.size > cdOffset) throw new ZipError("corrupt");
      const blob = file.slice(start, start + info.size, type);
      if (blob.size !== info.size) throw new ZipError("corrupt");
      if ((await crcOfBlob(blob)) !== info.crc) throw new ZipError("crc-mismatch");
      return blob;
    },
  };
}
