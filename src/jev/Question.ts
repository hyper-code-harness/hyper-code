/** One typed question evaluated against a shared state. */
export type Question =
    | {
        type: "noul";
        /** The yes/no question to evaluate against the state. */
        instructions: types.jev.Entry;
        /** Optional clarification of what a yes and a no mean. */
        criteria?: { true?: string; false?: string };
    }
    | {
        type: "choice";
        /** What the model should decide. */
        instructions: types.jev.Entry;
        /** Option name to rubric description, or null when the name speaks for itself; at most 255 entries. */
        criteria: Record<string, types.jev.Entry>;
    }
    | {
        type: "score";
        /** What the model should rate. */
        instructions: types.jev.Entry;
        /** Ordered level descriptions, lowest first. */
        criteria: types.jev.Entry[];
    };
