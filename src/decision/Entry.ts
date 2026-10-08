/** Content accepted anywhere a decision engine takes natural language: plain text or JSON structure. */
export type Entry = string | Record<string, unknown> | unknown[] | null;
