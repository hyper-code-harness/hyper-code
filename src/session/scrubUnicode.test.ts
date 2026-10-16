import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("scrubUnicode preserves valid Unicode and replaces unsafe code units", async () => {
    const ctx: any = await mkTestCtx();
    expect(await ctx.fns.session.scrubUnicode({ text: "ok 😀 привет" })).toBe("ok 😀 привет");
    expect(await ctx.fns.session.scrubUnicode({ text: "a\0b\uD800c\uDC00d" })).toBe("a�b�c�d");
});

test("appendMessage persists malformed provider Unicode in text and jsonb safely", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:echo" });
    await ctx.fns.session.save({ agent });
    let failure: unknown;
    try {
        await ctx.fns.session.appendMessage({ id: agent.id, message: {
            role: "assistant", content: "bad \uD800 nul \0", tool_calls: [{ id: "x", name: "t", args: { bad: "\uDC00" } }], result_ref: { bad: "\uD800" },
        } });
    } catch (error) { failure = error; }
    if (failure) throw failure;
    const [row] = await ctx.fns.procs.db.select({ sql: "SELECT content, tool_calls::text AS tool_calls, result_ref::text AS result_ref FROM messages WHERE agent_id=? ORDER BY idx DESC LIMIT 1", params: [agent.id] });
    expect(row.content).toBe("bad � nul �");
    expect(row.tool_calls).toContain("�");
    expect(row.result_ref).toContain("�");
});
