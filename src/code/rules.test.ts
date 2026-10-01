import { test, expect, describe } from "bun:test";
import { testCtx } from "../$test";

const check = async (text: string, rel = "shop/thing.ts") => {
    const ctx = await testCtx({});
    return ctx.fns.code.rules({ text, rel });
};

describe("code.rules", () => {
    test("an empty catch is reported", async () => {
        const hits = await check(`export default function () {\n    try { risky(); } catch {}\n}\n`);
        expect(hits.map(h => h.rule)).toEqual(["empty-catch"]);
        expect(hits[0]!.line).toBe(2);
    });

    test("an empty catch with a reason beside it is left alone", async () => {
        // The point is not to ban the pattern — a best-effort cleanup is a real
        // thing — but to ban doing it silently.
        const hits = await check(`export default function () {\n    // best effort: the file may already be gone\n    try { rm(); } catch {}\n}\n`);
        expect(hits).toEqual([]);
    });

    test("a rethrow that drops the original error is reported", async () => {
        const hits = await check(`export default function () {\n    try { go(); } catch (err) {\n        throw new Error("could not go");\n    }\n}\n`);
        expect(hits.map(h => h.rule)).toEqual(["lost-cause"]);
        expect(hits[0]!.detail).toContain("cause: err");
    });

    test("a rethrow that passes the cause is accepted", async () => {
        const hits = await check(`export default function () {\n    try { go(); } catch (err) {\n        throw new Error("could not go", { cause: err });\n    }\n}\n`);
        expect(hits).toEqual([]);
    });

    test("a throw outside any catch is not a lost cause", async () => {
        const hits = await check(`export default function () {\n    if (!ok) throw new Error("bad input");\n}\n`);
        expect(hits).toEqual([]);
    });

    test("String(form.get(...)) is reported", async () => {
        // FormData.get returns string | File; a File becomes "[object Object]",
        // so the data is silently replaced instead of failing.
        const hits = await check(`export default async function (ctx: Context, s: any, opts: { req: Request }) {\n    const form = await opts.req.formData();\n    return String(form.get("name") ?? "");\n}\n`);
        expect(hits.map(h => h.rule)).toEqual(["formdata-to-string"]);
    });

    test("String() of anything else is fine", async () => {
        const hits = await check(`export default function (opts: { n: number }) {\n    return String(opts.n);\n}\n`);
        expect(hits).toEqual([]);
    });

    test("a runtime function with a fourth parameter is reported", async () => {
        const hits = await check(`export default async function (ctx: Context, s: Session, opts: {}, extra: number) {\n    return extra;\n}\n`);
        expect(hits.map(h => h.rule)).toEqual(["extra-parameter"]);
    });

    test("the normal three-parameter shape is accepted", async () => {
        const hits = await check(`export default async function (ctx: Context, s: Session | null, opts: { a: number }) {\n    return opts.a;\n}\n`);
        expect(hits).toEqual([]);
    });

    test("a clean file produces nothing", async () => {
        const hits = await check(`export default function () {\n    return 42;\n}\n`);
        expect(hits).toEqual([]);
    });
});
