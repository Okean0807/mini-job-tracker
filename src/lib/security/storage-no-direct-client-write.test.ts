import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guards for migration 20261012160000 (moved from supabase/pending; applied to prod on merge) (drop direct client INSERT/UPDATE
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

// ---------------------------------------------------------------------------
// Closing the documented guard gaps (QA #135). The write-call scan above is
// complemented by an ALLOW-LIST rule: every reference to `.storage` must be the
// head of an immediate `.storage.from(<b>).<read-or-remove method>(...)` call
// chain. Anything else (aliasing the client/bucket, passing it to a wrapper,
// computed/bracket access, `.call/.apply/.bind`, extracting a method, destructuring
// `storage`) is reported as an escape, so wrappers can no longer hide writes.
// Raw HTTP to `/storage/v1` and a separately constructed `StorageClient` /
// `@supabase/storage-js` import are reported as well.
// ---------------------------------------------------------------------------
const ALLOWED_STORAGE_METHODS = new Set([
  "createSignedUrl",
  "createSignedUrls",
  "remove",
  "list",
  "download",
  "getPublicUrl",
]);

const kindFor = (f: string) =>
  /\.tsx$/.test(f)
    ? ts.ScriptKind.TSX
    : /\.(m|c)?jsx?$/.test(f)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;

const literalText = (e: ts.Node) =>
  ts.isStringLiteralLike(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;

export function findStorageEscapes(source: string, fileName = "x.ts"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kindFor(fileName));
  const hits: string[] = [];
  const hit = (n: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
    hits.push(`${fileName}:${line + 1}:${why}`);
  };
  const isStorageRef = (n: ts.Node) =>
    (ts.isPropertyAccessExpression(n) && n.name.text === "storage") ||
    (ts.isElementAccessExpression(n) && literalText(n.argumentExpression) === "storage");
  const memberName = (n: ts.Node) =>
    ts.isPropertyAccessExpression(n)
      ? n.name.text
      : ts.isElementAccessExpression(n)
        ? literalText(n.argumentExpression)
        : undefined;
  const isCallee = (n: ts.Node) =>
    !!n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n;
  const allowedChain = (ref: ts.Node) => {
    const from = ref.parent;
    if (
      !from ||
      memberName(from) !== "from" ||
      (from as ts.PropertyAccessExpression).expression !== ref
    )
      return false;
    if (!isCallee(from)) return false;
    const method = from.parent.parent;
    if (!method || (method as ts.PropertyAccessExpression).expression !== from.parent) return false;
    const m = memberName(method);
    return !!m && ALLOWED_STORAGE_METHODS.has(m) && isCallee(method);
  };
  const visit = (n: ts.Node) => {
    if (isStorageRef(n) && !allowedChain(n)) hit(n, "storage-escape");
    // computed key on a supabase client / storage expression: cannot be resolved statically
    if (ts.isElementAccessExpression(n) && literalText(n.argumentExpression) === undefined) {
      const t = n.expression.getText(sf);
      if (/\bstorage\b|\bsupabase\b|\badmin\b|createClient\(/.test(t)) hit(n, "computed-access");
    }
    if (ts.isBindingElement(n)) {
      const prop = n.propertyName
        ? (literalText(n.propertyName) ??
          (ts.isIdentifier(n.propertyName) ? n.propertyName.text : undefined))
        : undefined;
      const local = ts.isIdentifier(n.name) ? n.name.text : undefined;
      if ((prop ?? local) === "storage") hit(n, "storage-destructure");
    }
    const lit =
      literalText(n) ??
      (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.text : undefined);
    if (lit !== undefined && /storage\/v1/i.test(lit)) hit(n, "raw-storage-http");
    if (ts.isImportDeclaration(n) && literalText(n.moduleSpecifier) === "@supabase/storage-js")
      hit(n, "storage-js-import");
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(sf) === "require" &&
      n.arguments[0] &&
      literalText(n.arguments[0]) === "@supabase/storage-js"
    )
      hit(n, "storage-js-import");
    if (ts.isIdentifier(n) && n.text === "StorageClient") hit(n, "storage-client");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...new Set(hits)];
}

const GAP_NEGATIVE: Record<string, string> = {
  bracketComputedMethod: `const m = "upload"; supabase.storage.from(B)[m](p, f);`,
  bracketStorageLiteral: `supabase["storage"].from(B).upload(p, f);`,
  bracketStorageComputed: `const k = "stor" + "age"; supabase[k].from(B).upload(p, f);`,
  callIndirect: `const b = supabase.storage.from(B); b.upload.call(b, p, f);`,
  applyIndirect: `supabase.storage.from(B).upload.apply(null, [p, f]);`,
  bindIndirect: `const up = supabase.storage.from(B).upload.bind(x); up(p, f);`,
  methodExtracted: `const { upload } = supabase.storage.from(B); upload(p, f);`,
  wrapperParam: `function put(bucket: any) { return bucket.upload(p, f); } put(supabase.storage.from(B));`,
  wrapperReturn: `export const docsBucket = () => supabase.storage.from(B);`,
  wrapperClient: `export function helper(c: any) { return c.storage; }`,
  destructuredStorage: `const { storage } = supabase; doIt(storage);`,
  rawFetch: `fetch(\`\${url}/storage/v1/object/documents/\${uid}/x\`, { method: "POST" });`,
  rawFetchLiteral: `fetch(SUPABASE_URL + "/storage/v1/object/documents/a", { method: "PUT" });`,
  xhr: `const x = new XMLHttpRequest(); x.open("POST", "/storage/v1/object/documents/a");`,
  beacon: `navigator.sendBeacon("https://p.supabase.co/storage/v1/object/documents/a", blob);`,
  storageClientNew: `import { StorageClient } from "@supabase/storage-js"; const sc = new StorageClient(u, h);`,
  storageJsRequire: `const sj = require("@supabase/storage-js");`,
};
const GAP_POSITIVE: Record<string, string> = {
  signedUrl: `await supabase.storage.from(BUCKET).createSignedUrl(path, 600);`,
  remove: `await supabase.storage.from(BUCKET).remove([doc.path]);`,
  multilineAllowed: `await supabase\n  .storage\n  .from(BUCKET)\n  .createSignedUrl(\n    path,\n    600,\n  );`,
  clientOptionStorageKey: `createClient(u, k, { auth: { storage: undefined, persistSession: false } });`,
  localStorage: `localStorage.setItem("k", "v"); window.localStorage["k"];`,
  storageScopeImport: `import { scopeSuffix } from "@/lib/minijob/storage-scope";`,
  googleStorageUrl: `const og = "https://storage.googleapis.com/x/og.png";`,
  arrayIndex: `const xs = [1, 2]; const i = 0; xs[i];`,
  invokeUploadFn: `await supabase.functions.invoke("upload-document", { body });`,
  postgrestUpdate: `await supabase.from("documents").update(patch).eq("id", id);`,
};

/** All tracked-style JS/TS sources outside node_modules/dist/.git, tests excluded. */
function listAllSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", ".output", ".vercel", ".tanstack", "coverage"].includes(e))
      continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listAllSources(p, out);
    else if (
      /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e) &&
      !/\.test\.(ts|tsx)$/.test(e) &&
      !/\.d\.ts$/.test(e)
    )
      out.push(p);
  }
  return out;
}

describe("storage guard gaps (QA #135)", () => {
  it.each(Object.entries(GAP_NEGATIVE))("reports gap fixture: %s", (_n, src) => {
    expect(findStorageEscapes(src).length).toBeGreaterThan(0);
  });
  it.each(Object.entries(GAP_POSITIVE))("no false positive: %s", (_n, src) => {
    expect(findStorageEscapes(src)).toEqual([]);
  });

  it("client-side code anywhere in the repo (src/, scripts/, root configs) has no storage escape, write, raw /storage/v1 or StorageClient", () => {
    const files = listAllSources(root).filter(
      (f) => !relative(root, f).startsWith(join("supabase", "functions")),
    );
    expect(files.some((f) => relative(root, f).startsWith("scripts"))).toBe(true); // scope really widened
    const hits = files.flatMap((f) => {
      const src = readFileSync(f, "utf8");
      const rel = relative(root, f);
      return [...findStorageEscapes(src, rel), ...findStorageWrites(src, rel)];
    });
    expect(hits).toEqual([]);
  });

  it("server-side Edge Functions (service role, not affected by the policy drop): Storage writes are pinned to upload-document only", () => {
    const fnFiles = listAllSources(resolve(root, "supabase/functions"));
    const writes = fnFiles.flatMap((f) =>
      findStorageWrites(readFileSync(f, "utf8"), relative(root, f)).map((h) =>
        h.replace(/:\d+:/, ":"),
      ),
    );
    expect(new Set(writes)).toEqual(
      new Set(writes.filter((w) => /^supabase\/functions\/upload-document\/[^:]+:upload$/.test(w))),
    );
    expect(writes.length).toBeGreaterThan(0);
  });
});

describe("20261012160000 SQL (supabase/migrations; applied on merge)", () => {
  const strip = (s: string) => s.replace(/^--.*$/gm, "");
  const fwd = strip(
    readFileSync(
      resolve(root, "supabase/migrations/20261012160000_p2_documents_no_direct_client_write.sql"),
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
