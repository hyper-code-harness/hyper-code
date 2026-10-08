// Answers keep the field names existing call sites already branch on: a yes/no
// answer reports type "noul" with a `noul` probability, and carries the same
// value as `probability` for code written against OpenAI wording.

/** One typed answer, returned under the question id that produced it. */
export type Answer =
    | {
        type: "noul";
        /** Probability of yes, 0 to 1. */
        noul: number;
        /** Same value as `noul`, under the OpenAI name. */
        probability: number;
    }
    | {
        type: "choice";
        /** Option with the highest probability. */
        choice: string;
        /** Probability per offered option; values sum to 1. */
        probabilities: Record<string, number>;
        /** How peaked the distribution is, 0 to 1. */
        confidence: number;
    }
    | {
        type: "score";
        /** Probability-weighted position along the offered levels, starting at 0. */
        score: number;
        /** Level descriptions in the order they were offered. */
        legend?: string[];
        /** Probability per level index; values sum to 1. */
        probabilities: Record<string, number>;
        /** How peaked the distribution is, 0 to 1. */
        confidence: number;
    };
