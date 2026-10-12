import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guards for the PENDING migration 20261012160000 (drop direct client INSERT/UPDATE
// policies on the documents bucket). Content/structure checks only: passing does NOT
// mean the policies are dropped in production.

const root = process.cwd();
const WRITE_METHODS = new Set([
  "upload",
  "update",
  "uploadToSignedUrl",
  "createSignedUploadUrl",
  "move",
  "copy",
]);

/**
 * Structural scan (TypeScript AST): reports calls `<recv>.<method>(...)` with a
 * Storage write method whose receiver resolves (through local const/let aliases,
 * destructuring and parentheses) to an expression that touches `.storage`.
 * Postgrest `.from("t").update()` does not touch `.storage` and is not reported.
 */
export function findStorageWrites(source: string, fileName = "x.ts"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const aliases = new Map<string, ts.Expression>();
  const storageNames = new Set<string>();
  const visitDecl = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      if (ts.isIdentifier(n.name)) aliases.set(n.name.text, n.initializer);
      else if (ts.isObjectBindingPattern(n.name))
        for (const el of n.name.elements) {
          const prop =
            el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : undefined;
          const local = ts.isIdentifier(el.name) ? el.name.text : undefined;
          if (local && (prop ?? local) === "storage") storageNames.add(local);
        }
    }
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);
  const touchesStorage = (e: ts.Node, seen = new Set<string>()): boolean => {
    if (ts.isIdentifier(e)) {
      if (e.text === "storage" || storageNames.has(e.text)) return true;
      const a = aliases.get(e.text);
      if (a && !seen.has(e.text)) {
        seen.add(e.text);
        return touchesStorage(a, seen);
      }
      return false;
    }
    if (ts.isPropertyAccessExpression(e) && e.name.text === "storage") return true;
    let hit = false;
    ts.forEachChild(e, (c) => {
      if (!hit && touchesStorage(c, seen)) hit = true;
    });
    return hit;
  };
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      let callee: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(callee) || ts.isNonNullExpression(callee))
        callee = callee.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text
          : undefined;
      if (
        name &&
        WRITE_METHODS.has(name) &&
        touchesStorage((callee as ts.PropertyAccessExpression).expression)
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
        hits.push(`${fileName}:${line + 1}:${name}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

const NEGATIVE: Record<string, string> = {
  direct: `supabase.storage.from("documents").upload(p, f);`,
  multiline: `await supabase\n  .storage\n  .from(BUCKET)\n  .upload(\n    path,\n    file,\n  );`,
  alias: `const bucket = supabase.storage.from(BUCKET);\nawait bucket.upload(p, f);`,
  aliasChain: `const s = supabase.storage; const b = s.from("documents"); b.update(p, f);`,
  destructured: `const { storage } = supabase; storage.from(B).upload(p, f);`,
  renamed: `const { storage: st } = supabase; st.from(B).uploadToSignedUrl(p, t, f);`,
  signedUpload: `supabase.storage.from(B).createSignedUploadUrl(p);`,
  elementAccess: `supabase.storage.from(B)["upload"](p, f);`,
  moveCopy: `supabase.storage.from(B).move(a, b); supabase.storage.from(B).copy(a, b);`,
};
const POSITIVE: Record<string, string> = {
  invokeUploadFn: `await supabase.functions.invoke("upload-document", { body });`,
  signedUrl: `await supabase.storage.from(BUCKET).createSignedUrl(path, 600);`,
  remove: `await supabase.storage.from(BUCKET).remove([doc.path]);`,
  postgrestUpdate: `await supabase.from("documents").update(patch).eq("id", id);`,
  unrelatedUpload: `const uploader = makeUploader(); uploader.upload(file);`,
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe("storage write guard (AST)", () => {
  it.each(Object.entries(NEGATIVE))("detects direct Storage write: %s", (_n, src) => {
    expect(findStorageWrites(src).length).toBeGreaterThan(0);
  });
  it("detects both move and copy", () => {
    expect(findStorageWrites(NEGATIVE["moveCopy"]!)).toHaveLength(2);
  });
  it.each(Object.entries(POSITIVE))("allows: %s", (_n, src) => {
    expect(findStorageWrites(src)).toEqual([]);
  });
  it("app code under src/ (non-test) has no direct Storage write", () => {
    const hits = listSourceFiles(resolve(root, "src")).flatMap((f) =>
      findStorageWrites(readFileSync(f, "utf8"), relative(root, f)),
    );
    expect(hits).toEqual([]);
  });
});

describe("PENDING 20261012160000 SQL", () => {
  const strip = (s: string) => s.replace(/^--.*$/gm, "");
  const fwd = strip(
    readFileSync(
      resolve(root, "supabase/pending/20261012160000_p2_documents_no_direct_client_write.sql"),
      "utf8",
    ),
  );
  const rb = strip(
    readFileSync(
      resolve(
        root,
        "supabase/pending/rollback/20261012160000_p2_documents_no_direct_client_write.rollback.sql",
      ),
      "utf8",
    ),
  );
  const mig = readFileSync(
    resolve(root, "supabase/migrations/20260930192515_p1_rls_performance_hardening.sql"),
    "utf8",
  );
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  it("forward drops exactly the INSERT and UPDATE policies and creates nothing", () => {
    expect(fwd).toMatch(
      /drop policy if exists "Users upload own document files" on storage\.objects;/,
    );
    expect(fwd).toMatch(
      /drop policy if exists "Users update own document files" on storage\.objects;/,
    );
    expect(fwd).not.toMatch(
      /create policy|grant|revoke|alter table|delete from|read own|delete own/i,
    );
  });

  it("rollback re-creates both policies byte-identical (whitespace-normalised) to 20260930192515", () => {
    for (const name of ["Users upload own document files", "Users update own document files"]) {
      const re = new RegExp(`CREATE POLICY "${name}"[\\s\\S]*?;`);
      const inMig = mig.match(re)?.[0];
      const inRb = rb.match(re)?.[0];
      expect(inMig).toBeTruthy();
      expect(norm(inRb ?? "")).toBe(norm(inMig!));
    }
    expect(rb).not.toMatch(/read own|delete own|grant|revoke/i);
  });
});
