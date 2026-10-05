import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.list", () => {
    test("empty → []", async () => {
        const ctx: any = await mkTestCtx();
        expect(await ctx.fns.session.list()).toEqual([]);
    });

    test("returns lightweight summaries ordered by updated_at desc", async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.renderEventHtml = async (_c: any, _s: any, _o: any) => '';
        const a = await ctx.fns.agent.start({ model: "m1" });
        await ctx.fns.session.save({ agent: a });
        await ctx.fns.session.appendUserMessage({ id: a.id, text: 'first msg' });

        await new Promise(r => setTimeout(r, 5));
        const b = await ctx.fns.agent.start({ model: "m2" });
        await ctx.fns.session.save({ agent: b });

        const rows = await ctx.fns.session.list();
        expect(rows).toHaveLength(2);
        expect(rows[0]!.id).toBe(b.id);         // newest first
        expect(rows[1]!.id).toBe(a.id);
        expect(rows[1]!.title).toBe("first msg");
        expect(rows[0]!.title).toBe("(empty)");
        expect(rows[0]!.model).toBe("m2");
    });
    test("unread is a boolean for assistant text and explicit stop events", async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.renderEventHtml = async () => '';
        const agent = await ctx.fns.agent.start({ model: "m1" });
        await ctx.fns.session.save({ agent });
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "tool_call", name: "read" } });
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "assistant", text: "" } });
        expect((await ctx.fns.session.list()).find((a: any) => a.id === agent.id)?.unread).toBe(0);
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "assistant", text: "done" } });
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "error", error: "stopped by user" } });
        expect((await ctx.fns.session.list()).find((a: any) => a.id === agent.id)?.unread).toBe(1);
    });

    test("defaults to nav and supports explicit visibility filters", async () => {
        const ctx: any = await mkTestCtx();
        const nav = await ctx.fns.agent.start({ model: "m", title: "Nav" });
        const fork = await ctx.fns.session.fork({ id: nav.id, visibility: "nav" });
        const team = await ctx.fns.session.fork({ id: nav.id, visibility: "team" });
        const hidden = await ctx.fns.session.fork({ id: nav.id, visibility: "hidden" });

        expect((await ctx.fns.session.list()).map((a: any) => a.id)).toEqual([fork.id, nav.id]);
        expect((await ctx.fns.session.list({ visibility: ["team"] })).map((a: any) => a.id)).toEqual([team.id]);
        expect((await ctx.fns.session.list({ visibility: ["hidden"] })).map((a: any) => a.id)).toEqual([hidden.id]);
        expect((await ctx.fns.session.list({ visibility: ["nav", "team", "hidden"] })).map((a: any) => a.visibility).sort()).toEqual(["hidden", "nav", "nav", "team"]);
    });



});
