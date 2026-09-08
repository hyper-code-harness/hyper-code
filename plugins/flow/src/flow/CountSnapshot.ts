/** Aggregate preview count only; never contains gap payloads or medical data. */
export type CountSnapshot = { count: number | null; checkedAt: number | null; attemptedAt: number; stale: boolean; partial: boolean };
