/** What a successful submission produces. */
export type Outcome = {
    /** JSON stored on the row and shown to the agent — never a secret value. */
    result: Record<string, any>;
    /** One line the agent reads first, e.g. "chose b" or "secret secret://x/y is stored". */
    summary: string;
};
