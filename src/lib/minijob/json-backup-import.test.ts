import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  generation: 1,
  current: true,
  replaceAll: vi.fn(),
}));

vi.mock("./store", () => ({
  getScopeGeneration: () => store.generation,
  isScopeCurrent: () => store.current,
  replaceAll: store.replaceAll,
}));
vi.mock("./payload", () => ({
  isValidPayload: (v: unknown) =>
    typeof v === "object" && v !== null && Array.isArray((v as { shifts?: unknown }).shifts),
}));

import { importJsonBackupFile } from "./json-backup-import";

const file = (text: string) => ({ text: async () => text });

describe("importJsonBackupFile — failed imports never touch stored data", () => {
  beforeEach(() => {
    store.current = true;
    store.replaceAll.mockReset();
  });

  it("valid backup is imported", async () => {
    await expect(importJsonBackupFile(file('{"shifts":[]}'))).resolves.toBe("imported");
    expect(store.replaceAll).toHaveBeenCalledTimes(1);
  });

  it("malformed JSON rejects (dialog shows imp.jsonError) and writes nothing", async () => {
    await expect(importJsonBackupFile(file("{not json"))).rejects.toThrow();
    expect(store.replaceAll).not.toHaveBeenCalled();
  });

  it("JSON that is not a backup is 'invalid' and writes nothing", async () => {
    await expect(importJsonBackupFile(file('{"hello":1}'))).resolves.toBe("invalid");
    expect(store.replaceAll).not.toHaveBeenCalled();
  });

  it("an XLSX renamed to .json is rejected without writing", async () => {
    await expect(importJsonBackupFile(file("PK\u0003\u0004binary"))).rejects.toThrow();
    expect(store.replaceAll).not.toHaveBeenCalled();
  });

  it("account switched while reading: 'stale', nothing written", async () => {
    store.current = false;
    await expect(importJsonBackupFile(file('{"shifts":[]}'))).resolves.toBe("stale");
    expect(store.replaceAll).not.toHaveBeenCalled();
  });

  it("a failing file read rejects without writing", async () => {
    await expect(
      importJsonBackupFile({ text: () => Promise.reject(new Error("read failed")) }),
    ).rejects.toThrow("read failed");
    expect(store.replaceAll).not.toHaveBeenCalled();
  });
});
