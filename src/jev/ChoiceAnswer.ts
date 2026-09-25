/** Selected option plus the full probability distribution across the offered options. */
export type ChoiceAnswer = {
    type: "choice";
    /** Option with the highest probability. */
    choice: string;
    /** Probability per offered option; values sum to 1. */
    probabilities: Record<string, number>;
    /** How peaked the distribution is, 0 to 1. */
    confidence: number;
};
