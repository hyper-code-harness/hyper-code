/** Position on the ordered levels plus the distribution across them. */
export type ScoreAnswer = {
    type: "score";
    /** Position along the offered levels. */
    score: number;
    /** Level descriptions in the order they were offered. */
    legend?: string[];
    /** Probability per level; values sum to 1. */
    probabilities: Record<string, number>;
    /** How peaked the distribution is, 0 to 1. */
    confidence: number;
};
