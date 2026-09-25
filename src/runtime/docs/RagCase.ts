/** One labelled retrieval intent used to score runtime-function search. */
export type RagCase = {
    /** Prompt exactly as a user would write it. */
    query: string;
    /** Function names that count as a correct top hit. */
    expected: string[];
    /** Additional names that are acceptable but not required. */
    relevant?: string[];
    /** True when the correct behaviour is to retrieve nothing at all. */
    noResult?: boolean;
    /** Where the case came from: a hand-written probe or a real transcript. */
    source?: "synthetic" | "transcript";
};
