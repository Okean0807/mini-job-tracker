import type { AskSource } from "@/lib/ai/types";

/** Prefer title; otherwise hostname — never invent a citation label. */
export function sourceDisplayLabel(source: AskSource): string {
  const title = source.title?.trim();
  if (title) return title;
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}
