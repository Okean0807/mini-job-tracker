/** Data-safety Phase 1 – Herkunfts-Klassifizierung. */
import { describe, expect, it } from "vitest";

import { CANONICAL_HOST, classifyOrigin, deriveOriginNotice, hostnameOf } from "./origin-check";

describe("classifyOrigin", () => {
  it("kanonischer Host (auch mit Schema, Port, Pfad, Großschreibung)", () => {
    expect(CANONICAL_HOST).toBe("mini-job-tracker-blue.vercel.app");
    for (const value of [
      "mini-job-tracker-blue.vercel.app",
      "https://mini-job-tracker-blue.vercel.app/einstellungen?x=1",
      "MINI-JOB-TRACKER-BLUE.VERCEL.APP",
      "mini-job-tracker-blue.vercel.app.",
      "mini-job-tracker-blue.vercel.app:443",
    ]) {
      expect(classifyOrigin(value)).toBe("canonical");
    }
  });

  it("localhost und Entwicklung → development", () => {
    for (const value of [
      "localhost",
      "localhost:3000",
      "http://127.0.0.1:5173/",
      "http://[::1]:8080",
      "app.localhost",
    ]) {
      expect(classifyOrigin(value)).toBe("development");
    }
  });

  it("Vorschau-/Deployment-/fremde Hosts → non-canonical", () => {
    for (const value of [
      "mini-job-tracker-9eigj4s3z-okean0807.vercel.app",
      "mini-job-tracker-git-claude-minijob-smart-entr-304c24-okean0807.vercel.app",
      "mini-job-tracker-okean0807.vercel.app",
      "example.com",
    ]) {
      expect(classifyOrigin(value)).toBe("non-canonical");
    }
  });

  it("Täuschungsversuche gelten nicht als kanonisch", () => {
    for (const value of [
      "mini-job-tracker-blue.vercel.app.evil.com",
      "evil-mini-job-tracker-blue.vercel.app",
      "https://mini-job-tracker-blue.vercel.app@evil.com/",
      "localhost.evil.com",
    ]) {
      expect(classifyOrigin(value)).toBe("non-canonical");
    }
  });

  it("leer/ungültig → non-canonical (Unbekannt warnt)", () => {
    for (const value of [null, undefined, "", "   ", "http://"]) {
      expect(classifyOrigin(value)).toBe("non-canonical");
    }
    expect(hostnameOf("https://Example.COM:8443/x")).toBe("example.com");
  });
});

describe("deriveOriginNotice", () => {
  it("kanonisch und Entwicklung warnen nicht", () => {
    expect(deriveOriginNotice(CANONICAL_HOST)).toEqual({
      origin: "canonical",
      warn: false,
      reason: "canonical",
    });
    expect(deriveOriginNotice("localhost:3000")).toEqual({
      origin: "development",
      warn: false,
      reason: "development",
    });
  });

  it("Vorschau/unbekannt → Warnung non-canonical-host", () => {
    expect(deriveOriginNotice("mini-job-tracker-9eigj4s3z-okean0807.vercel.app")).toEqual({
      origin: "non-canonical",
      warn: true,
      reason: "non-canonical-host",
    });
  });

  it("Testmodus warnt immer als 'nur lokal', auch auf kanonischem Host und localhost", () => {
    expect(deriveOriginNotice(CANONICAL_HOST, { testMode: true })).toMatchObject({
      warn: true,
      reason: "test-mode",
    });
    expect(deriveOriginNotice("localhost", { testMode: true })).toMatchObject({
      warn: true,
      reason: "test-mode",
    });
    expect(deriveOriginNotice(CANONICAL_HOST, { testMode: false }).warn).toBe(false);
  });
});
