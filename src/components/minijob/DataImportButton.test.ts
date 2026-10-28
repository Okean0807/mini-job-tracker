/**
 * Behavioural tests for the data import entry point (Settings → General → "Datenübertragung"):
 * the button opens the existing ImportDialog, CSV/TXT shifts and JSON backups are handled by
 * the existing handlers, spreadsheets and oversized files are rejected before reading, and a
 * cancelled or failed import never changes stored data. Real store, jsdom-like DOM, no network.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { tl } from "@/lib/i18n";
import { csvTemplate } from "@/lib/minijob/csv";
import { getData, replaceAll, updateSettings } from "@/lib/minijob/store";
import type { Job, Settings } from "@/lib/minijob/types";

import { DataImportButton } from "./DataImportButton";
import { IMPORT_FILE_ACCEPT } from "./ImportDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const de = (key: string, vars?: Record<string, string | number>) => tl("de", key, vars);

let host: HTMLDivElement;
let root: Root;

function resetStore() {
  window.localStorage.clear();
  const current = getData();
  replaceAll({ ...current, shifts: [], jobs: [] });
  updateSettings({ language: "de" });
}

beforeEach(() => {
  toastMock.error.mockReset();
  toastMock.success.mockReset();
  toastMock.message.mockReset();
  resetStore();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount(jobs: Job[] = [], settings: Settings = getData().settings) {
  await act(async () => {
    root.render(createElement(DataImportButton, { jobs, settings }));
  });
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const openButton = () => host.querySelector<HTMLButtonElement>('[data-testid="data-import-open"]');
const fileInput = () => document.body.querySelector<HTMLInputElement>('input[type="file"]');
const buttonByText = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  );

async function openDialog() {
  await mount();
  await act(async () => {
    openButton()!.click();
  });
}

async function chooseFile(file: File) {
  const input = fileInput()!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
}

function fileWithText(name: string, text: string, type = "text/plain") {
  const file = new File([text], name, { type });
  const textSpy = vi.spyOn(file, "text");
  return { file, textSpy };
}

function oversized(name: string) {
  const { file, textSpy } = fileWithText(name, "x");
  Object.defineProperty(file, "size", { value: 2 * 1024 * 1024 + 1 });
  return { file, textSpy };
}

const snapshot = () => JSON.stringify({ s: getData().shifts, j: getData().jobs });

describe("the entry point opens the existing import", () => {
  it("renders an accessible button; a tap opens the ImportDialog (CSV, TXT, JSON only)", async () => {
    await mount();
    const button = openButton();
    expect(button).not.toBeNull();
    expect(button!.tagName).toBe("BUTTON");
    expect(button!.textContent).toContain(de("set.migration.import"));
    expect(button!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog()).toBeNull();

    await act(async () => {
      button!.click();
    });
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain(de("imp.title"));
    expect(fileInput()!.getAttribute("accept")).toBe(IMPORT_FILE_ACCEPT);
  });

  it("pressing the select button opens the system file input", async () => {
    await openDialog();
    const clickSpy = vi.spyOn(fileInput()!, "click");
    await act(async () => {
      buttonByText(de("imp.selectFile"))!.click();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fileInput()!.disabled).toBe(false);
  });

  it("the accept filter lists extensions and MIME types so Android does not grey out a CSV", () => {
    for (const token of [".csv", ".txt", ".json", "text/*", "application/json"]) {
      expect(IMPORT_FILE_ACCEPT.split(",")).toContain(token);
    }
    expect(IMPORT_FILE_ACCEPT).not.toMatch(/xlsx|spreadsheetml/);
  });
});

describe("picker feedback and re-selection", () => {
  it("a picked CSV is shown inline with its name, then the preview appears", async () => {
    await openDialog();
    const { file } = fileWithText(
      "minijob-2026-10-28.csv",
      csvTemplate(),
      "text/comma-separated-values",
    );
    await chooseFile(file);
    expect(dialog()!.textContent).toContain("minijob-2026-10-28.csv");
    expect(dialog()!.textContent).toContain(de("imp.summary", { valid: 2, invalid: 0 }));
  });

  it("an empty selection (cancel) changes nothing and shows no message", async () => {
    await openDialog();
    const before = snapshot();
    const input = fileInput()!;
    Object.defineProperty(input, "files", { value: [], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(snapshot()).toBe(before);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="import-selected"]')).toBeNull();
    expect(dialog()!.textContent).toContain(de("imp.selectFile"));
  });

  it("the input value is cleared after each pick so the same file can be chosen again", async () => {
    await openDialog();
    const input = fileInput()!;
    const valueSetter = vi.spyOn(input, "value", "set");
    await chooseFile(fileWithText("empty.csv", "").file);
    expect(valueSetter).toHaveBeenCalledWith("");
    // same file again still reaches the handler and reports again
    await chooseFile(fileWithText("empty.csv", "").file);
    expect(toastMock.error).toHaveBeenCalledTimes(2);
  });

  it("a rejected file is also reported inline, not only as a toast", async () => {
    await openDialog();
    await chooseFile(fileWithText("table.xlsx", "PK").file);
    const inline = document.body.querySelector('[data-testid="import-error"]');
    expect(inline?.textContent).toBe(de("imp.xlsxUnsupported"));
    expect(inline?.getAttribute("role")).toBe("alert");
  });

  it("a read failure is reported instead of being swallowed", async () => {
    await openDialog();
    const { file, textSpy } = fileWithText("shifts.csv", csvTemplate());
    textSpy.mockRejectedValue(new Error("denied"));
    await chooseFile(file);
    expect(toastMock.error).toHaveBeenCalledWith(de("imp.readError"));
    expect(document.body.querySelector('[data-testid="import-error"]')).not.toBeNull();
  });
});

describe("CSV / TXT shifts", () => {
  it("shows a preview, imports on confirm, and skips exact duplicates on a second import", async () => {
    await openDialog();
    const first = fileWithText("shifts.csv", csvTemplate());
    await chooseFile(first.file);
    expect(first.textSpy).toHaveBeenCalledTimes(1);
    expect(dialog()!.textContent).toContain(de("imp.summary", { valid: 2, invalid: 0 }));
    expect(getData().shifts).toHaveLength(0); // preview alone writes nothing

    await act(async () => {
      buttonByText(de("imp.confirm", { count: 2 }))!.click();
    });
    expect(getData().shifts).toHaveLength(2);
    expect(getData().jobs.map((j) => j.name)).toContain("Café Nord");
    expect(toastMock.success).toHaveBeenCalledWith(de("imp.imported", { count: 2 }));
    expect(dialog()).toBeNull(); // closed after success

    await act(async () => {
      openButton()!.click();
    });
    await chooseFile(fileWithText("again.txt", csvTemplate()).file);
    await act(async () => {
      buttonByText(de("imp.confirm", { count: 2 }))!.click();
    });
    expect(getData().shifts).toHaveLength(2); // duplicates skipped, nothing doubled
  });

  it("a file without data rows shows a message and changes nothing", async () => {
    await openDialog();
    const before = snapshot();
    await chooseFile(fileWithText("empty.csv", "").file);
    expect(toastMock.error).toHaveBeenCalledWith(de("imp.noRows"));
    expect(snapshot()).toBe(before);
  });

  it("choosing another file / closing the dialog after a preview keeps stored data untouched", async () => {
    await openDialog();
    const before = snapshot();
    await chooseFile(fileWithText("shifts.csv", csvTemplate()).file);
    await act(async () => {
      buttonByText(de("imp.otherFile"))!.click();
    });
    expect(snapshot()).toBe(before);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(snapshot()).toBe(before);
  });
});

describe("JSON backup (full replacement, confirmed first)", () => {
  const backupWith = (shifts: number) =>
    JSON.stringify({
      ...getData(),
      jobs: [{ id: "backup-job", name: "Backup-Job", color: "#112233", mode: "flex" }],
      shifts: Array.from({ length: shifts }, (_, i) => ({
        id: `b-${i}`,
        jobId: "backup-job",
        kind: "arbeit",
        date: "2026-09-01",
        start: "09:00",
        end: "12:00",
        breakMinutes: 0,
      })),
    });
  const seedFive = () => {
    replaceAll({
      ...getData(),
      jobs: [{ id: "old", name: "Alt", color: "#000000", mode: "flex" }],
      shifts: Array.from({ length: 5 }, (_, i) => ({
        id: `old-${i}`,
        jobId: "old",
        kind: "arbeit" as const,
        date: "2026-08-01",
        start: "08:00",
        end: "12:00",
        breakMinutes: 0,
      })),
    });
  };
  const text = (el: string) => document.body.querySelector(`[data-testid="${el}"]`)?.textContent;

  it("shows a summary first and changes nothing until the user confirms", async () => {
    await openDialog();
    seedFive();
    const before = snapshot();
    await chooseFile(fileWithText("backup.json", backupWith(1), "application/json").file);
    expect(text("restore-summary")).toContain(de("restore.warn"));
    expect(text("restore-current")).toBe(de("restore.counts", { shifts: 5, jobs: 1 }));
    expect(text("restore-incoming")).toBe(de("restore.counts", { shifts: 1, jobs: 1 }));
    expect(snapshot()).toBe(before);
    expect(toastMock.success).not.toHaveBeenCalled();

    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-testid="restore-confirm"]')!.click();
    });
    expect(getData().shifts.map((s) => s.id)).toEqual(["b-0"]);
    expect(getData().jobs.map((j) => j.name)).toEqual(["Backup-Job"]);
    expect(toastMock.success).toHaveBeenCalledWith(de("restore.success"), expect.anything());
    expect(dialog()).toBeNull();
  });

  it("cancelling after the summary keeps all data and returns to the picker", async () => {
    await openDialog();
    seedFive();
    const before = snapshot();
    await chooseFile(fileWithText("backup.json", backupWith(1), "application/json").file);
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-testid="restore-cancel"]')!.click();
    });
    expect(snapshot()).toBe(before);
    expect(text("restore-summary")).toBeUndefined();
    expect(dialog()!.textContent).toContain(de("imp.selectFile"));
  });

  it("an empty backup over existing data announces the deletion before anything happens", async () => {
    await openDialog();
    seedFive();
    const before = snapshot();
    await chooseFile(
      fileWithText(
        "empty.json",
        backupWith(0).replace(/"jobs":\[[^\]]*\]/, '"jobs":[]'),
        "application/json",
      ).file,
    );
    expect(text("restore-wipes")).toBe(de("restore.empty"));
    expect(snapshot()).toBe(before);
  });

  it("the success toast offers an undo that brings the previous state back", async () => {
    await openDialog();
    seedFive();
    const before = snapshot();
    await chooseFile(fileWithText("backup.json", backupWith(1), "application/json").file);
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-testid="restore-confirm"]')!.click();
    });
    const options = toastMock.success.mock.calls.find((c) => c[0] === de("restore.success"))![1];
    expect(options.action.label).toBe(de("restore.undo"));
    await act(async () => {
      options.action.onClick();
    });
    expect(snapshot()).toBe(before);
    expect(toastMock.success).toHaveBeenCalledWith(de("restore.undone"));
  });

  it("an invalid or broken backup is refused before any summary and the stored data stays as it was", async () => {
    await openDialog();
    seedFive();
    const before = snapshot();
    await chooseFile(fileWithText("wrong.json", '{"hello":1}', "application/json").file);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("(missing)"));
    expect(text("restore-summary")).toBeUndefined();
    expect(snapshot()).toBe(before);

    await chooseFile(fileWithText("broken.json", "{not json", "application/json").file);
    expect(toastMock.error).toHaveBeenCalledWith(de("imp.jsonError"));
    expect(snapshot()).toBe(before);

    const ghost = JSON.stringify({
      shifts: [{ id: "x", jobId: "ghost", date: "2026-09-01", start: "09:00", end: "10:00" }],
      jobs: [],
    });
    await chooseFile(fileWithText("ghost.json", ghost, "application/json").file);
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("jobId"));
    expect(snapshot()).toBe(before);
  });
});

describe("rejected files", () => {
  it.each(["table.xlsx", "table.xls", "TABLE.XLSX", "table.xlsm", "table.xlsb", "table.ods"])(
    "%s is rejected with the spreadsheet message and never read",
    async (name) => {
      await openDialog();
      const before = snapshot();
      const { file, textSpy } = fileWithText(name, "PK");
      await chooseFile(file);
      expect(toastMock.error).toHaveBeenCalledWith(de("imp.xlsxUnsupported"));
      expect(textSpy).not.toHaveBeenCalled();
      expect(snapshot()).toBe(before);
    },
  );

  it.each(["big.csv", "big.json", "big.txt"])(
    "%s above the size limit is rejected before it is read",
    async (name) => {
      await openDialog();
      const before = snapshot();
      const { file, textSpy } = oversized(name);
      await chooseFile(file);
      expect(toastMock.error).toHaveBeenCalledWith(de("imp.fileTooLarge"));
      expect(textSpy).not.toHaveBeenCalled();
      expect(snapshot()).toBe(before);
    },
  );
});
