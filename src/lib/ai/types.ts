/** Provider-neutral ask types for the KI assistant path. */

export type AskRequest = {
  question: string;
  context: string;
  language?: string;
};

export type AskSource = {
  title?: string;
  url: string;
};

export type AskResponse = {
  answer: string;
  sources?: AskSource[];
};
