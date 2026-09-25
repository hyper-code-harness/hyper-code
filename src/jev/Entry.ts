/** Content accepted anywhere Jev takes natural language: plain text or JSON structure. */
export type Entry = string | Record<string, unknown> | unknown[] | null;
