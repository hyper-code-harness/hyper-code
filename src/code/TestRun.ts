// A background test run started by code.runTests, counted live from bun's output.
export type TestRun = {
    running: boolean;
    startedAt: number;
    finishedAt?: number;
    exitCode: number | null;
    /** which tests: fast (*.test.ts), it (*.it.test.ts), live (*.live.test.ts), all (fast + it) */
    kind: TestKind;
    path: string;
    /** tests passed / failed / skipped so far */
    pass: number;
    fail: number;
    skip: number;
    /** test files started so far, and the one bun reported last */
    files: number;
    current: string;
    /** tests and files in the previous run — the estimate progress is measured against (0 when unknown) */
    expected: number;
    expectedFiles: number;
    /** names of the failed tests so far (last 200) */
    failed: string[];
};

/** A kind of test, by file name: fast *.test.ts, it *.it.test.ts (real processes), live *.live.test.ts (network); all = fast + it. */
export type TestKind = "fast" | "it" | "live" | "all";
