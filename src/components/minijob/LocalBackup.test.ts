/**
 * „Lokales Backup → Importieren“: gleicher Ablauf wie „Daten importieren“ (prüfen, Zusammenfassung,
 * erst nach Bestätigung ersetzen). Echter Store, echte Komponente, nur sonner ist gemockt.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { tl } from "@/lib/i18n";
import { MAX_BACKUP_BYTES } from "@/lib/minijob/backup-restore";
import { getData, replaceAll, saveJob, saveShift, updateSettings } from "@/lib/minijob/store";

import { LocalBackup } from "./LocalBackup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const de = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  window.localStorage.clear();
  replaceAll({ shifts: [], jobs: [] });
  updateSettings({ language: "de" });
  saveJob({ id: "old", name: "Alt", color: "#000000", mode: "flex" });
  for (let i = 0; i < 5; i += 1) {
    saveShift({
      id: `old-${i}`,
      jobId: "old",
      kind: "arbeit",
      date: "2026-08-01",
      start: "08:00",
      end: "12:00",
      breakMinutes: 0,
    });
  }
  toastMock.error.mockReset();
  toastMock.success.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(LocalBackup, { shiftCount: getData().shifts.length }));
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const input = () => host.querySelector<HTMLInputElement>('input[type="file"]')!;
const byId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const snapshot = () => JSON.stringify(getData());

async function choose(file: File) {
  Object.defineProperty(input(), "files", { value: [file], configurable: true });
  await act(async () => {
    input().dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
}
const backupFile = (value: unknown) =>
  new File([typeof value === "string" ? value : JSON.stringify(value)], "backup.json", {
    type: "application/json",
  });
const oneShift = {
  jobs: [{ id: "j1", name: "Neu", color: "#111111", mode: "flex" }],
  shifts: [
    { id: "n1", jobId: "j1", date: "2026-09-02", start: "09:00", end: "11:00", breakMinutes: 0 },
  ],
};

describe("Lokales Backup → Importieren", () => {
  it("still accepts JSON files in the picker and shows the stored count", () => {
    expect(input().getAttribute("accept")).toBe("application/json");
    expect(host.textContent).toContain(de("set.localBackup.desc", { count: 5 }));
  });

  it("asks for confirmation with a summary and changes nothing before it (5 → 1)", async () => {
    const before = snapshot();
    await choose(backupFile(oneShift));
    expect(byId("restore-current")!.textContent).toBe(de("restore.counts", { shifts: 5, jobs: 1 }));
    expect(byId("restore-incoming")!.textContent).toBe(
      de("restore.counts", { shifts: 1, jobs: 1 }),
    );
    expect(document.body.textContent).toContain(de("restore.warn"));
    expect(snapshot()).toBe(before);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("cancel keeps the data; confirm replaces it", async () => {
    const before = snapshot();
    await choose(backupFile(oneShift));
    await act(async () => byId("restore-cancel")!.click());
    expect(snapshot()).toBe(before);
    expect(byId("restore-summary")).toBeNull();

    await choose(backupFile(oneShift));
    await act(async () => byId("restore-confirm")!.click());
    expect(getData().shifts.map((s) => s.id)).toEqual(["n1"]);
    expect(toastMock.success).toHaveBeenCalledWith(de("restore.success"), expect.anything());
  });

  it("the same file can be chosen again (input value is cleared)", async () => {
    await choose(backupFile(oneShift));
    expect(input().value).toBe("");
    await act(async () => byId("restore-cancel")!.click());
    await choose(backupFile(oneShift));
    expect(byId("restore-summary")).not.toBeNull();
  });

  it.each([
    ["broken JSON", "{nope", de("imp.jsonError")],
    ["truncated JSON", JSON.stringify(oneShift).slice(0, -5), de("imp.jsonError")],
  ])("%s is refused and nothing changes", async (_name, content, message) => {
    const before = snapshot();
    await choose(backupFile(content));
    expect(toastMock.error).toHaveBeenCalledWith(message);
    expect(byId("restore-summary")).toBeNull();
    expect(snapshot()).toBe(before);
  });

  it("missing fields, unknown jobId and duplicate ids are refused with the offending path", async () => {
    const before = snapshot();
    const bad: [unknown, string][] = [
      [
        {
          jobs: [],
          shifts: [{ id: "x", jobId: "ghost", date: "2026-09-01", start: "09:00", end: "10:00" }],
        },
        "shifts[0].jobId",
      ],
      [
        { jobs: oneShift.jobs, shifts: [{ id: "x", jobId: "j1", start: "09:00", end: "10:00" }] },
        "shifts[0].date",
      ],
      [{ jobs: oneShift.jobs, shifts: [oneShift.shifts[0], oneShift.shifts[0]] }, "shifts[1].id"],
    ];
    for (const [value, path] of bad) {
      await choose(backupFile(value));
      expect(toastMock.error).toHaveBeenLastCalledWith(expect.stringContaining(path));
      expect(byId("restore-summary")).toBeNull();
    }
    expect(snapshot()).toBe(before);
  });

  it("a file above 2 MiB is refused before it is read", async () => {
    const before = snapshot();
    const big = backupFile("{}");
    const text = vi.spyOn(big, "text");
    Object.defineProperty(big, "size", { value: MAX_BACKUP_BYTES + 1 });
    await choose(big);
    expect(toastMock.error).toHaveBeenCalledWith(de("imp.fileTooLarge"));
    expect(text).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it("a storage write failure is reported as failure and keeps the previous state", async () => {
    const before = snapshot();
    await choose(backupFile(oneShift));
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      await act(async () => byId("restore-confirm")!.click());
    } finally {
      setItem.mockRestore();
    }
    expect(toastMock.error).toHaveBeenCalledWith(de("restore.persistFailed"));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });
});

describe("Lokales Backup → Exportieren (Meldungen)", () => {
  const exportButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === de("set.localBackup.export"),
    )!;
  const win = window as unknown as { showSaveFilePicker?: unknown };
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));

  afterEach(() => {
    delete win.showSaveFilePicker;
  });

  it("saved via picker → success toast 'gespeichert' only", async () => {
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const picker = vi.fn(async () => ({ createWritable: async () => writable }));
    win.showSaveFilePicker = picker;
    await act(async () => {
      exportButton().click();
      expect(picker).toHaveBeenCalledTimes(1); // synchronously inside the click
    });
    await settle();
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith(de("set.localBackup.saved"));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("cancelled → neither success nor error toast", async () => {
    win.showSaveFilePicker = async () => {
      throw Object.assign(new Error("x"), { name: "AbortError" });
    };
    await act(async () => exportButton().click());
    await settle();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(exportButton().disabled).toBe(false);
  });

  it("write failure → error toast, no success", async () => {
    win.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async () => {
          throw new Error("disk full");
        },
        close: async () => {},
        abort: async () => {},
      }),
    });
    await act(async () => exportButton().click());
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith(de("set.localBackup.exportFailed"));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("no picker API → download fallback with the existing 'Backup-Datei erstellt' message", async () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => "blob:t";
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => exportButton().click());
    await settle();
    expect(click).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith(de("set.localBackup.created"));
    click.mockRestore();
  });
});
