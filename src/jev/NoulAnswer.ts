/** Yes/no answer: the probability that the statement is true. Carries no confidence field. */
export type NoulAnswer = {
    type: "noul";
    /** Probability of yes, 0 to 1. */
    noul: number;
};
