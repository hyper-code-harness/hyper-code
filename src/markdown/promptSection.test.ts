import { test, expect, describe } from "bun:test";
import promptSection from "./promptSection";

// The prompt must be a function of what is loaded, so every test here builds a
// different fence registry and reads what the agent would be told.
const mkCtx = (fences: Record<string, any> | null) => {
    const ctx: any = { fns: { procs: { log: { warn: () => {} } } } };
    ctx.state = fences === null ? {} : { markdown: { fences } };
    return ctx as Context;
};

const fence = (lang: string, hint?: any) => ({ lang, module: lang, rel: `${lang}/$fence_${lang}.ts`, render: async () => "", hint });

describe("markdown.promptSection", () => {
    test("lists hinted fences alphabetically, with the hint", async () => {
        const text = await promptSection(mkCtx({
            vega: fence("vega", "charts from a spec"),
            mermaid: fence("mermaid", "diagrams with automatic layout"),
        }), null, {});
        expect(text).toContain("## Markdown fences");
        expect(text.indexOf("```mermaid")).toBeLessThan(text.indexOf("```vega"));
        expect(text).toContain("- ```mermaid — diagrams with automatic layout");
    });

    test("a fence with no hint stays out of the prompt", async () => {
        const text = await promptSection(mkCtx({ quiet: fence("quiet"), loud: fence("loud", "shown") }), null, {});
        expect(text).toContain("loud");
        expect(text).not.toContain("quiet");
    });

    test("a hint function may hide a fence that is switched off", async () => {
        const text = await promptSection(mkCtx({
            off: fence("off", async () => null),
            on: fence("on", async () => "available right now"),
        }), null, {});
        expect(text).toContain("- ```on — available right now");
        expect(text).not.toContain("```off");
    });

    test("the hint sees ctx, so it can describe what is actually enabled", async () => {
        const ctx = mkCtx({ sqlish: fence("sqlish", (c: any) => (c.enabled ? "with SQL" : "files only")) });
        (ctx as any).enabled = true;
        expect(await promptSection(ctx, null, {})).toContain("with SQL");
    });

    test("a throwing hint costs its own line, not the whole prompt", async () => {
        const text = await promptSection(mkCtx({
            broken: fence("broken", () => { throw new Error("nope"); }),
            fine: fence("fine", "still here"),
        }), null, {});
        expect(text).toContain("still here");
        expect(text).not.toContain("```broken");
    });

    test("nothing loaded means no heading at all", async () => {
        expect(await promptSection(mkCtx(null), null, {})).toBe("");
        expect(await promptSection(mkCtx({}), null, {})).toBe("");
        expect(await promptSection(mkCtx({ quiet: fence("quiet") }), null, {})).toBe("");
    });
});
