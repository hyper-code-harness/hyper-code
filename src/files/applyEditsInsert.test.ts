// Regression: insert_after used to land one line too low ("after line 1" came
// out after line 2), and EOF on a file with a trailing newline added a blank line.
import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("files.applyEdits inserts", () => {
    const path = ".test-tmp/apply_insert/a.txt";
    async function run(content: string, ops: (anchors: string[]) => any[]) {
        const ctx = await mkTestCtx({ db: false });
        await ctx.fns.files.write({ path, content });
        const anchors = (await ctx.fns.files.readHashline({ path })).lines.map((l: any) => l.anchor);
        await ctx.fns.files.applyEdits({ path, ops: ops(anchors) });
        return await ctx.fns.files.read({ path });
    }

    test("insert_after an anchor lands directly after that line", async () => {
        expect(await run("L1\nL2\nL3\n", a => [{ kind: "insert_after", anchor: a[0], lines: ["X"] }])).toBe("L1\nX\nL2\nL3\n");
        expect(await run("L1\nL2\nL3\n", a => [{ kind: "insert_after", anchor: a[2], lines: ["X"] }])).toBe("L1\nL2\nL3\nX\n");
    });

    test("insert_before and insert_after on the same line wrap it", async () => {
        expect(await run("L1\nL2\nL3\n", a => [
            { kind: "insert_before", anchor: a[1], lines: ["B"] },
            { kind: "insert_after", anchor: a[1], lines: ["A"] },
        ])).toBe("L1\nB\nL2\nA\nL3\n");
    });

    test("replace plus insert_after on the same anchor", async () => {
        expect(await run("L1\nL2\nL3\n", a => [
            { kind: "replace", start: a[1], lines: ["R"] },
            { kind: "insert_after", anchor: a[1], lines: ["A"] },
        ])).toBe("L1\nR\nA\nL3\n");
    });

    test("BOF / EOF with and without trailing newline, and on an empty file", async () => {
        expect(await run("L1\nL2\n", () => [{ kind: "insert_after", anchor: "EOF", lines: ["X"] }])).toBe("L1\nL2\nX\n");
        expect(await run("L1\nL2", () => [{ kind: "insert_after", anchor: "EOF", lines: ["X"] }])).toBe("L1\nL2\nX");
        expect(await run("L1\nL2\n", () => [{ kind: "insert_before", anchor: "EOF", lines: ["X"] }])).toBe("L1\nL2\nX\n");
        expect(await run("L1\nL2\n", () => [{ kind: "insert_after", anchor: "BOF", lines: ["X"] }])).toBe("X\nL1\nL2\n");
        expect(await run("", () => [{ kind: "insert_after", anchor: "EOF", lines: ["X"] }])).toBe("X");
    });
});
