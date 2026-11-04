import { describe, expect, it } from "vitest";

import { ZipError, buildZip, crc32, looksLikeZip, openZip } from "./zip-store";

const LIM = { maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
const bytes = (s: string) => new TextEncoder().encode(s);
const blob = (s: string | Uint8Array, type = "") => new Blob([s as BlobPart], { type });
async function raw(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}
async function expectZipError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: "ZipError", code });
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zip round trip", () => {
  it("stores and reads several entries byte-exactly, with sizes and CRCs", async () => {
    const bin = new Uint8Array(5000).map((_, i) => (i * 31) % 251);
    const zip = await buildZip([
      { name: "manifest.json", data: blob('{"a":1}') },
      { name: "documents/abc-1", data: blob(bin) },
      { name: "documents/empty", data: blob("") },
    ]);
    expect(looksLikeZip((await raw(zip)).slice(0, 4))).toBe(true);
    const a = await openZip(zip, LIM);
    expect(a.entries.map((e) => e.name)).toEqual([
      "manifest.json",
      "documents/abc-1",
      "documents/empty",
    ]);
    expect(await raw(await a.read("documents/abc-1"))).toEqual(bin);
    expect(await (await a.read("manifest.json")).text()).toBe('{"a":1}');
    expect((await a.read("documents/empty")).size).toBe(0);
    expect(a.entries[1]?.crc).toBe(crc32(bin));
  });
  it("is deterministic: the same input yields byte-identical archives", async () => {
    const mk = () =>
      buildZip([
        { name: "x/a", data: blob("hello") },
        { name: "x/b", data: blob("world") },
      ]);
    expect(await raw(await mk())).toEqual(await raw(await mk()));
  });
  it("types the read blob as requested", async () => {
    const a = await openZip(await buildZip([{ name: "f", data: blob("x") }]), LIM);
    expect((await a.read("f", "application/pdf")).type).toBe("application/pdf");
  });
  it("refuses unsafe or duplicate names when building", async () => {
    for (const name of ["../evil", "/abs", "a//b", "a b", "ä", "", "a/../b"]) {
      await expectZipError(buildZip([{ name, data: blob("x") }]), "bad-entry-name");
    }
    await expectZipError(
      buildZip([
        { name: "a", data: blob("1") },
        { name: "a", data: blob("2") },
      ]),
      "bad-entry-name",
    );
  });
});

describe("zip reader is strict (corrupt / hostile input)", () => {
  async function good() {
    return raw(
      await buildZip([
        { name: "manifest.json", data: blob("{}") },
        { name: "documents/d1", data: blob("PAYLOAD-BYTES") },
      ]),
    );
  }
  const open = (u: Uint8Array) => openZip(new Blob([u as BlobPart]), LIM);

  it("detects a flipped data byte (CRC mismatch)", async () => {
    const z = await good();
    const at = new TextDecoder().decode(z).indexOf("PAYLOAD");
    z[at + 3] = (z[at + 3] as number) ^ 0xff;
    const a = await open(z);
    await expectZipError(a.read("documents/d1"), "crc-mismatch");
  });
  it("rejects truncated / empty / random data", async () => {
    const z = await good();
    await expectZipError(open(z.slice(0, z.length - 10)), "corrupt");
    await expectZipError(open(new Uint8Array(10)), "corrupt");
    await expectZipError(open(new Uint8Array(200).fill(7)), "corrupt");
    await expectZipError(open(z.slice(0, 40)), "corrupt");
  });
  it("rejects compressed, encrypted and descriptor-based entries", async () => {
    for (const [off, val] of [
      [10, 8],
      [8, 1],
      [8, 8],
    ] as [number, number][]) {
      const z = await good();
      const dv = new DataView(z.buffer);
      let cd = -1;
      for (let i = z.length - 22; i >= 0; i -= 1)
        if (dv.getUint32(i, true) === 0x06054b50) {
          cd = dv.getUint32(i + 16, true);
          break;
        }
      dv.setUint16(cd + off, val, true);
      await expectZipError(open(z), "unsupported");
    }
  });
  it("rejects ZIP64 markers and multi-disk archives", async () => {
    const z = await good();
    const dv = new DataView(z.buffer);
    const eocd = z.length - 22;
    dv.setUint16(eocd + 10, 0xffff, true);
    await expectZipError(open(z), "unsupported");
    const z2 = await good();
    new DataView(z2.buffer).setUint16(z2.length - 22 + 4, 1, true);
    await expectZipError(open(z2), "unsupported");
  });
  it("rejects entries beyond the limits (zip-bomb style declarations)", async () => {
    const z = await good();
    await expectZipError(
      openZip(new Blob([z as BlobPart]), { maxEntryBytes: 4, maxTotalBytes: 1e9 }),
      "entry-too-large",
    );
    await expectZipError(
      openZip(new Blob([z as BlobPart]), { maxEntryBytes: 1e9, maxTotalBytes: 10 }),
      "archive-too-large",
    );
  });
  it("rejects a central directory that points outside the file", async () => {
    const z = await good();
    new DataView(z.buffer).setUint32(z.length - 22 + 16, 0x00ffffff, true);
    await expectZipError(open(z), "corrupt");
  });
  it("rejects a mismatch between local header and central directory", async () => {
    const z = await good();
    const dv = new DataView(z.buffer);
    dv.setUint32(14, 0x12345678, true); // CRC in the first local header
    const a = await open(z);
    await expectZipError(a.read("manifest.json"), "corrupt");
  });
  it("rejects two entries with the same name (patched archive)", async () => {
    const z = new Uint8Array(
      await (
        await buildZip([
          { name: "aa", data: blob("1") },
          { name: "ab", data: blob("2") },
        ])
      ).arrayBuffer(),
    );
    const text = new TextDecoder("latin1").decode(z);
    // rename "ab" -> "aa" in the central directory (the last occurrence is the central directory record)
    const at = text.lastIndexOf("ab");
    z[at + 1] = "a".charCodeAt(0);
    await expectZipError(open(z), "duplicate-entry");
  });
  it("rejects trailing garbage after the end-of-central-directory record", async () => {
    const z = await good();
    const withTail = new Uint8Array(z.length + 5);
    withTail.set(z);
    withTail.set([1, 2, 3, 4, 5], z.length);
    await expectZipError(open(withTail), "corrupt");
  });
  it("reading a missing entry fails clearly", async () => {
    const a = await open(await good());
    await expectZipError(a.read("nope"), "missing-entry");
  });
  it("ZipError carries only a code (no content in the message)", () => {
    expect(new ZipError("corrupt").message).toBe("corrupt");
  });
});
