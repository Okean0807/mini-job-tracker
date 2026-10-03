import { describe, expect, it } from "vitest";
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE } from "./documents";

describe("document upload security boundary", () => {
  it("caps uploads at 20 MiB", () => expect(MAX_DOCUMENT_SIZE).toBe(20 * 1024 * 1024));
  it("allows only server-validated document media types", () => {
    expect(ALLOWED_DOCUMENT_MIME_TYPES).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });
});
