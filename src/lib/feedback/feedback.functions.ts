import { createServerFn } from "@tanstack/react-start";

import { parseFeedbackInput } from "./schema";

/**
 * Öffentliche Server-Funktion (kein Login nötig – auch Gäste können Feedback senden).
 * Zugriff auf die Datenbank nur serverseitig über den service_role-Client in
 * `feedback.server.ts`; Browser und Rollen anon/authenticated haben keinen Tabellenzugriff.
 */
export const submitFeedback = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => parseFeedbackInput(input))
  .handler(async ({ data }) => {
    const { submitFeedbackServer } = await import("./feedback.server");
    return submitFeedbackServer(data);
  });
