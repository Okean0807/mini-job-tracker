/**
 * Export der lokalen Sicherung: System-Speicherdialog wo verfügbar, sonst Download; Abbruch ist
 * ein normaler Ausgang; Schreibfehler werden gemeldet. Echter Store, Browser-APIs sind Test-Doubles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BACKUP_MIME, defaultBackupFilename, exportBackup, serializeBackup } from "./backup-export";
import { getData, replaceAll, saveJob, saveShift } from "./store";

type PickerWindow = { showSaveFilePicker?: unknown };
const win = window as unknown as PickerWindow;

function seed() {
  window.localStorage.clear();
  replaceAll({ shifts: [], jobs: [] });
  saveJob({ id: "j1", name: "Café", color: "#0d9488", mode: "flex" });
  saveShift({
    id: "s1",
    jobId: "j1",
    kind: "arbeit",
    date: "2026-09-01",
    start: "09:00",
    end: "13:00",
    breakMinutes: 0,
  });
}

function writableMock(overrides: Partial<Record<"write" | "close" | "abort", unknown>> = {}) {
  const chunks: Blob[] = [];
  return {
    chunks,
    write: vi.fn(async (b: Blob) => void chunks.push(b)),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    ...overrides,
  };
}
const domError = (name: string) => Object.assign(new Error(name), { name });

let createdBlobs: Blob[];
let anchors: HTMLAnchorElement[];

beforeEach(() => {
  seed();
  delete win.showSaveFilePicker;
  createdBlobs = [];
  anchors = [];
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn((b: Blob) => {
    createdBlobs.push(b);
    return "blob:test";
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push(this);
  });
});
afterEach(() => {
  delete win.showSaveFilePicker;
  vi.restoreAllMocks();
});

describe("serialization and file name", () => {
  it("keeps the existing JSON schema/format exactly", () => {
    expect(serializeBackup(getData())).toBe(JSON.stringify(getData(), null, 2));
  });

  it("default file name is minijob-companion-backup-YYYY-MM-DD.json", () => {
    expect(defaultBackupFilename(new Date(2026, 8, 5))).toBe(
      "minijob-companion-backup-2026-09-05.json",
    );
  });
});

describe("save picker supported", () => {
  it("opens the picker synchronously (user activation), writes the exact JSON, reports saved", async () => {
    const writable = writableMock();
    const picker = vi.fn(async () => ({ createWritable: async () => writable }));
    win.showSaveFilePicker = picker;

    const result = exportBackup(getData());
    expect(picker).toHaveBeenCalledTimes(1); // before any await
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: expect.stringMatching(/^minijob-companion-backup-\d{4}-\d{2}-\d{2}\.json$/),
        types: [{ description: "JSON", accept: { [BACKUP_MIME]: [".json"] } }],
      }),
    );
    await expect(result).resolves.toBe("saved");

    expect(writable.close).toHaveBeenCalledTimes(1);
    const blob = writable.chunks[0]!;
    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe(JSON.stringify(getData(), null, 2));
    expect(createdBlobs).toHaveLength(0); // no download fallback used
  });

  it("the written file is restorable by the unchanged restore path", async () => {
    const writable = writableMock();
    win.showSaveFilePicker = async () => ({ createWritable: async () => writable });
    await exportBackup(getData());
    const text = await writable.chunks[0]!.text();
    const { validateBackup } = await import("./backup-validate");
    expect(validateBackup(JSON.parse(text)).ok).toBe(true);
  });

  it("user cancellation (AbortError) is a normal outcome: cancelled, nothing written or downloaded", async () => {
    win.showSaveFilePicker = vi.fn(async () => {
      throw domError("AbortError");
    });
    await expect(exportBackup(getData())).resolves.toBe("cancelled");
    expect(createdBlobs).toHaveLength(0);
  });

  it("a write failure is reported as failed and the writable is aborted", async () => {
    const writable = writableMock({
      write: vi.fn(async () => {
        throw domError("NotAllowedError");
      }),
    });
    win.showSaveFilePicker = async () => ({ createWritable: async () => writable });
    await expect(exportBackup(getData())).resolves.toBe("failed");
    expect(writable.abort).toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
  });

  it("a failing close() (data not flushed) is failed, not saved", async () => {
    const writable = writableMock({
      close: vi.fn(async () => {
        throw domError("QuotaExceededError");
      }),
    });
    win.showSaveFilePicker = async () => ({ createWritable: async () => writable });
    await expect(exportBackup(getData())).resolves.toBe("failed");
  });

  it("createWritable failure is failed", async () => {
    win.showSaveFilePicker = async () => ({
      createWritable: async () => {
        throw domError("NotAllowedError");
      },
    });
    await expect(exportBackup(getData())).resolves.toBe("failed");
  });

  it("an unusable picker (SecurityError, e.g. embedded context) falls back to the download", async () => {
    win.showSaveFilePicker = vi.fn(async () => {
      throw domError("SecurityError");
    });
    await expect(exportBackup(getData())).resolves.toBe("downloaded");
    expect(anchors).toHaveLength(1);
  });

  it("any other picker error is failed (no silent download behind the user's back)", async () => {
    win.showSaveFilePicker = vi.fn(async () => {
      throw domError("UnknownError");
    });
    await expect(exportBackup(getData())).resolves.toBe("failed");
    expect(anchors).toHaveLength(0);
  });
});

describe("save picker unsupported → existing download", () => {
  it("downloads a JSON blob with the default name and reports downloaded", async () => {
    expect(win.showSaveFilePicker).toBeUndefined();
    await expect(exportBackup(getData())).resolves.toBe("downloaded");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.download).toMatch(/^minijob-companion-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(createdBlobs[0]!.type).toBe("application/json");
    expect(await createdBlobs[0]!.text()).toBe(JSON.stringify(getData(), null, 2));
  });

  it("a non-function showSaveFilePicker is treated as unsupported", async () => {
    win.showSaveFilePicker = "nope";
    await expect(exportBackup(getData())).resolves.toBe("downloaded");
  });

  it("a download that cannot be started is failed", async () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => {
      throw new Error("blocked");
    };
    await expect(exportBackup(getData())).resolves.toBe("failed");
  });
});
