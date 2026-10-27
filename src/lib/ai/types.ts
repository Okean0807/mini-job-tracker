/** Provider-neutral ask types for the KI assistant path. */

import type { WebSearchFailureReason } from "@/lib/ai/web-search/types";

export type AskRequest = {
  question: string;
  context: string;
  language?: string;
};

export type AskSource = {
  title?: string;
  url: string;
};

/**
 * Server-side marker for answers that were returned but are not clean successes. It is only
 * used for diagnostics (never sent to the client); user-visible wording is part of `answer`.
 */
export type AskDegraded = "truncated" | "unexpected_finish";

export type AskResponse = {
  answer: string;
  sources?: AskSource[];
  degraded?: AskDegraded;
  /**
   * Server-side marker: a live web check was wanted but could not run. Closed reason code only
   * (diagnostics; never sent to the client, the user-visible note is part of `answer`).
   */
  searchUnavailable?: WebSearchFailureReason;
};

export interface AIProvider {
  ask(req: AskRequest, opts?: { signal?: AbortSignal }): Promise<AskResponse>;
}
