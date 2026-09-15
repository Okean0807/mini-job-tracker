import { describe, expect, it } from "vitest";

import { sourceDisplayLabel } from "./sources";

describe("sourceDisplayLabel", () => {
  it("prefers title over hostname", () => {
    expect(sourceDisplayLabel({ url: "https://example.com/a", title: "Example" })).toBe(
      "Example",
    );
  });

  it("falls back to hostname", () => {
    expect(sourceDisplayLabel({ url: "https://www.bmas.de/path" })).toBe("www.bmas.de");
  });
});
