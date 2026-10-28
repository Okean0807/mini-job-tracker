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
    expect(fileInput()!.getAttribute("accept")).toBe(".csv,.txt,.json");
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

describe("JSON backup", () => {
  const validBackup = () =>
    JSON.stringify({
      ...getData(),
      jobs: [{ id: "backup-job", name: "Backup-Job", color: "#112233", mode: "flex" }],
      shifts: [],
    });

  it("a valid backup is applied and reported", async () => {
    await openDialog();
    await chooseFile(fileWithText("backup.json", validBackup(), "application/json").file);
    expect(toastMock.success).toHaveBeenCalledWith(de("imp.jsonSuccess"));
    expect(getData().jobs.map((j) => j.name)).toEqual(["Backup-Job"]);
  });

  it("an invalid or unreadable backup is refused and the stored data stays as it was", async () => {
    await openDialog();
    const before = snapshot();
    await chooseFile(fileWithText("wrong.json", '{"hello":1}', "application/json").file);
    expect(toastMock.error).toHaveBeenCalledWith(de("imp.jsonInvalid"));
    expect(snapshot()).toBe(before);

    await chooseFile(fileWithText("broken.json", "{not json", "application/json").file);
    expect(toastMock.error).toHaveBeenCalledWith(de("imp.jsonError"));
    expect(snapshot()).toBe(before);
  });
});

describe("rejected files", () => {
  it.each(["table.xlsx", "table.xls", "TABLE.XLSX"])(
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
