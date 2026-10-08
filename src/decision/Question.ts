// Engine-neutral question contract. Jev calls the yes/no primitive "noul", the
// OpenAI Decisions API calls it "predicate"; both names are accepted here and
// normalized by each engine, so a call site never names a vendor.

/** One typed question evaluated against shared evidence, portable across decision engines. */
export type Question =
    | {
        /** Yes/no primitive: "noul" in Jev wording, "predicate" in OpenAI wording. */
        type: "noul" | "predicate";
        /** The yes/no question to evaluate against the evidence. */
        instructions: types.decision.Entry;
        /** Optional clarification of what a yes and a no mean. */
        criteria?: { true?: string; false?: string };
    }
    | {
        type: "choice";
        /** What the engine should decide. */
        instructions: types.decision.Entry;
        /** Option name to rubric description, or null when the name speaks for itself; at most 255 entries. */
        criteria: Record<string, types.decision.Entry>;
    }
    | {
        type: "score";
        /** What the engine should rate. */
        instructions: types.decision.Entry;
        /** Ordered level descriptions, lowest first; indices start at 0. */
        criteria: types.decision.Entry[];
    };
