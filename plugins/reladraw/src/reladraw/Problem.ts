/** One source problem reported by the reladraw parser or solver. */
export type Problem = {
    /** 1-based source line, or 0 when the problem is not tied to a line. */
    line: number;
    /** Message in the vocabulary of the source, e.g. `two placements for "server"`. */
    message: string;
};
