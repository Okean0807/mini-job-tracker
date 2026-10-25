import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiMarkdown } from "./AiMarkdown";

const html = (text: string) => renderToStaticMarkup(createElement(AiMarkdown, { text }));

describe("AiMarkdown — KI answer rendering", () => {
  it("renders **bold** section labels instead of literal asterisks", () => {
    const out = html("📊 **Deine Daten**\nDu hast 0 Stunden erfasst.\n\n📈 **Einschätzung**");
    expect(out).toContain("<strong>Deine Daten</strong>");
    expect(out).toContain("<strong>Einschätzung</strong>");
    expect(out).not.toContain("**");
    expect(out).toContain("<br/>");
  });

  it("renders headings, bullet and numbered lists, italic and code", () => {
    const out = html(
      "## Überblick\n- erste\n- **zweite**\n\n1. eins\n2. zwei\n\n*Schätzung* mit `13,90 €`",
    );
    expect(out).toContain('<p class="font-semibold">Überblick</p>');
    expect(out).toMatch(/<ul[^>]*><li>erste<\/li><li><strong>zweite<\/strong><\/li><\/ul>/);
    expect(out).toMatch(/<ol[^>]*><li>eins<\/li><li>zwei<\/li><\/ol>/);
    expect(out).toContain("<em>Schätzung</em>");
    expect(out).toMatch(/<code[^>]*>13,90 €<\/code>/);
    expect(out).not.toContain("#");
  });

  it("escapes HTML and script in model output (no injection)", () => {
    const out = html(
      '<script>alert(1)</script>\n**<img src=x onerror="alert(2)">**\n[x](javascript:alert(3))',
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<a\s/i);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("<strong>&lt;img src=x onerror=&quot;alert(2)&quot;&gt;</strong>");
  });

  it("leaves unmatched markers and snake_case as plain text", () => {
    const out = html("2 * 3 = 6 und **offen\nmonthly_limit_value");
    expect(out).toContain("2 * 3 = 6 und **offen");
    expect(out).toContain("monthly_limit_value");
  });
});

describe("AiMarkdown — LaTeX in KI answers becomes readable text", () => {
  it("converts the Preview formula ($$\\text…\\frac…$$) to plain text, no raw markup", () => {
    const out = html(
      "**Grobe Hochrechnung:**\n$$\\text{Hochrechnung} = \\frac{111{,}20\\ €}{25} \\times 31 \\approx 137{,}89\\ €$$",
    );
    expect(out).toContain("<strong>Grobe Hochrechnung:</strong>");
    expect(out).toContain("Hochrechnung = 111,20 € ÷ 25 × 31 ≈ 137,89 €");
    expect(out).not.toMatch(/\$|\\|\\text|\\frac|[{}]/);
  });

  it("handles \\( … \\) and \\[ … \\] spans and inline $…\\cmd…$", () => {
    expect(html("Rechnung: \\(8 \\cdot 13{,}90\\) €")).toContain("Rechnung: 8 · 13,90 €");
    expect(html("\\[ a \\leq b \\]")).toContain("a ≤ b");
    expect(html("ca. $55{,}60 \\div 25$ pro Tag")).toContain("ca. 55,60 ÷ 25 pro Tag");
  });

  it("leaves plain dollar amounts alone and keeps HTML inside math escaped", () => {
    expect(html("Kosten: 5 $ und 10 $")).toContain("Kosten: 5 $ und 10 $");
    const out = html("$$\\text{<script>alert(1)</script>}$$");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
