import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

test("canvas opens and closes per agent, keeps the chat width, and the agent page follows", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    const b = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    await r.fns.session.save({ agent: b });

    expect(await ctx.fns.canvas.get({ agentId: a.id })).toEqual({ agentId: a.id, open: false, chatWidth: 440, activeItemId: null });
    const page = async (id: string) => (await ctx.fns.procs.http.dispatch({ method: "GET", url: `http://localhost/agent/${id}` })).text();
    let html = await page(a.id);
    expect(html).toContain('data-canvas-panel');
    expect(html).toContain('data-canvas-toggle="toggle"');
    expect(html).not.toMatch(/data-canvas-agent="[^"]+" data-canvas-open/);

    const events: any[] = [];
    const subs: Set<any> = ctx.state.procs.events.subs ??= new Set();
    const sub = (ev: any) => { if (ev?.type === "canvas.changed") events.push(ev); };
    subs.add(sub);
    const post = (id: string, body: any) => ctx.fns.procs.http.dispatch({ method: "POST", url: `http://localhost/canvas/${id}`, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await post(a.id, { open: true, chatWidth: 520 });
    expect(await res.json()).toMatchObject({ open: true, chatWidth: 520 });
    subs.delete(sub);
    expect(events).toMatchObject([{ agentId: a.id, open: true, chatWidth: 520 }]);

    html = await page(a.id);
    expect(html).toMatch(/data-canvas-agent="[^"]+" data-canvas-open style="--chat-w:520px"/);
    // Another agent's canvas is untouched.
    expect((await ctx.fns.canvas.get({ agentId: b.id })).open).toBe(false);

    // Closing keeps the width; width is clamped; unknown agents are refused.
    await post(a.id, { open: false });
    expect(await ctx.fns.canvas.get({ agentId: a.id })).toMatchObject({ open: false, chatWidth: 520 });
    await post(a.id, { chatWidth: 50 });
    expect((await ctx.fns.canvas.get({ agentId: a.id })).chatWidth).toBe(320);
    expect((await post("nope-no-such", { open: true })).status).toBe(404);
});
