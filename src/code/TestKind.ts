/** A kind of test, by file name: fast *.test.ts, it *.it.test.ts (real processes), live *.live.test.ts (network); all = fast + it. */
export type TestKind = "fast" | "it" | "live" | "all";
