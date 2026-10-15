import { test, expect } from "bun:test";
import { kindOf, testFiles, timeoutFlag, DEFAULT_TIMEOUT_MS } from "./test";

test("the kind of a test is in its file name", () => {
    expect(kindOf("src/a/x.test.ts")).toBe("fast");
    expect(kindOf("src/a/x.it.test.ts")).toBe("it");
    expect(kindOf("src/a/x.live.test.ts")).toBe("live");
});

test("each kind lists only its own files; all = fast + it, never live", () => {
    const fast = testFiles("fast"), it = testFiles("it"), live = testFiles("live"), all = testFiles("all");
    expect(fast.length).toBeGreaterThan(100);
    expect(it).toContain("src/remote/remote.it.test.ts");
    expect(live).toContain("plugins/medsearch/src/medsearch/search.live.test.ts");
    expect(fast.some(f => f.endsWith(".it.test.ts") || f.endsWith(".live.test.ts"))).toBe(false);
    expect(all.length).toBe(fast.length + it.length);
    expect([...fast, ...it, ...live].some(f => f.includes("node_modules"))).toBe(false);
});

test("a per-test timeout is set unless the caller sets one", () => {
    expect(timeoutFlag([], {})).toEqual([`--timeout=${DEFAULT_TIMEOUT_MS}`]);
    expect(timeoutFlag([], { TEST_TIMEOUT_MS: "60000" })).toEqual(["--timeout=60000"]);
    expect(timeoutFlag(["--timeout=1000"], { TEST_TIMEOUT_MS: "60000" })).toEqual([]);
});
