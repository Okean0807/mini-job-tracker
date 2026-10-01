import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("P1 document account-isolation migration", () => {
  it("enforces user, storage-path and folder ownership at the database boundary", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260930090000_p1_account_isolation_documents.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("NEW.user_id <> auth.uid()");
    expect(migration).toContain("path_owner <> NEW.user_id::text");
    expect(migration).toContain("folder_owner <> NEW.user_id");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF user_id, path, folder_id");
  });
});
