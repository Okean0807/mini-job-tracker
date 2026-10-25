/**
 * Minimal Markdown renderer for KI answers.
 *
 * Builds React elements only — no HTML strings, no dangerouslySetInnerHTML —
 * so any `<script>`, `<img onerror>` or raw HTML in a model answer is rendered
 * as escaped text. Supported: headings (#), bullet/numbered lists, **bold**,
 * __bold__, *italic*, `code`, paragraphs and line breaks. Links stay plain text
 * (sources are rendered separately from allowlisted URLs).
 */
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\s][^*\n]*?\*)/g;

function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}-${n++}`;
    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "p"; lines: string[] };

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const prev = blocks[blocks.length - 1];
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (line.trim() === "") {
      if (prev && prev.kind !== "heading") blocks.push({ kind: "p", lines: [] });
    } else if (heading) {
      blocks.push({ kind: "heading", text: heading[1]! });
    } else if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? ordered)![1]!;
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (prev && prev.kind === "p") {
      prev.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length > 0);
}

export function AiMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseBlocks(text).map((block, i) => {
        const key = `b${i}`;
        if (block.kind === "heading") {
          return (
            <p key={key} className="font-semibold">
              {renderInline(block.text, key)}
            </p>
          );
        }
        if (block.kind !== "p") {
          const List = block.kind;
          return (
            <List
              key={key}
              className={`${block.kind === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}
            >
              {block.items.map((item, j) => (
                <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, j) => (
              <Fragment key={`${key}-${j}`}>
                {j > 0 ? <br /> : null}
                {renderInline(line, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
