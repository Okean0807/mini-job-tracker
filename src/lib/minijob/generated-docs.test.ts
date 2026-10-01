import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearGeneratedDocuments,
  deleteGeneratedDocument,
  listGeneratedDocuments,
  registerGeneratedDocument,
  saveAndRegisterBytes,
} from "./generated-docs";

beforeEach(() => {
  clearGeneratedDocuments();
  vi.stubGlobal(
    "URL",
    class {
      static createObjectURL = vi.fn(() => "blob:mock");
      static revokeObjectURL = vi.fn();
    },
  );
  document.body.innerHTML = "";
});

afterEach(() => {
  clearGeneratedDocuments();
  vi.unstubAllGlobals();
});

describe("generated docs registry", () => {
  it("registers and lists exports newest first", () => {
    registerGeneratedDocument({
      name: "a.pdf",
      category: "report_pdf",
      mimeType: "application/pdf",
      size: 10,
      dataUrl: "data:application/pdf;base64,AA==",
      createdAt: "2026-01-01T10:00:00.000Z",
    });
    registerGeneratedDocument({
      name: "b.xlsx",
      category: "report_xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 20,
      dataUrl: "",
      createdAt: "2026-02-01T10:00:00.000Z",
    });
    const list = listGeneratedDocuments();
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe("b.xlsx");
    expect(list[1]?.name).toBe("a.pdf");
    expect(list.every((d) => d.source === "generated")).toBe(true);
    expect(list[0]?.payloadStatus).toBe("downloaded_only");
    expect(list[1]?.payloadStatus).toBe("local");
  });

  it("deletes by id without touching others", () => {
    const a = registerGeneratedDocument({
      name: "keep.pdf",
      category: "arbeitsnachweis",
      mimeType: "application/pdf",
      size: 1,
    });
    const b = registerGeneratedDocument({
      name: "drop.pdf",
      category: "worklog",
      mimeType: "application/pdf",
      size: 1,
    });
    deleteGeneratedDocument(b.id);
    const list = listGeneratedDocuments();
    expect(list.map((d) => d.id)).toEqual([a.id]);
  });

  it("saveAndRegisterBytes downloads and registers", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const doc = saveAndRegisterBytes({
      bytes,
      filename: "Monatsbericht.pdf",
      category: "report_pdf",
      mimeType: "application/pdf",
    });
    expect(doc.name).toBe("Monatsbericht.pdf");
    expect(doc.category).toBe("report_pdf");
    expect(doc.size).toBe(4);
    expect(doc.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(listGeneratedDocuments()).toHaveLength(1);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});


describe("generated docs quota handling", () => {
  it("evicts oldest payloads first instead of stripping every export", () => {
    registerGeneratedDocument({
      name: "older.pdf",
      category: "report_pdf",
      mimeType: "application/pdf",
      size: 10,
      dataUrl: "data:application/pdf;base64,OLD",
      createdAt: "2026-01-01T10:00:00.000Z",
    });

    const originalSetItem = Storage.prototype.setItem;
    let attempts = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      attempts += 1;
      if (attempts === 1) throw new DOMException("quota", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    });

    registerGeneratedDocument({
      name: "newer.pdf",
      category: "report_pdf",
      mimeType: "application/pdf",
      size: 20,
      dataUrl: "data:application/pdf;base64,NEW",
      createdAt: "2026-02-01T10:00:00.000Z",
    });

    const list = listGeneratedDocuments();
    expect(list[0]?.name).toBe("newer.pdf");
    expect(list[0]?.payloadStatus).toBe("local");
    expect(list[0]?.dataUrl).toContain("NEW");
    expect(list[1]?.name).toBe("older.pdf");
    expect(list[1]?.payloadStatus).toBe("downloaded_only");
    expect(list[1]?.dataUrl).toBe("");
  });
});
