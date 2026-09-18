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
