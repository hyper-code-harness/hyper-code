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

test("canvas shows a file from the catalog as a tab pinned to the agent, switches and closes tabs", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    expect((await ctx.fns.canvas.kinds({})).map((k: any) => k.name)).toContain("file");
    await expect(ctx.fns.canvas.show({ agentId: a.id, kind: "evil", args: {} })).rejects.toThrow("unknown kind");
    await expect(ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "no/such/file.ts" } })).rejects.toThrow("file not found");

    const one = await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "package.json" } });
    expect(one).toMatchObject({ kind: "file", title: "package.json", active: true });
    expect(one.args.path).toEndWith("/package.json");
    const two = await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "README.md", mode: "preview" } });
    expect(await ctx.fns.canvas.get({ agentId: a.id })).toMatchObject({ open: true, activeItemId: two.id });
    // The same file again switches back to its tab instead of adding one.
    expect((await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "package.json" } })).id).toBe(one.id);
    expect((await ctx.fns.canvas.list({ agentId: a.id })).map((i: any) => [i.id, i.active])).toEqual([[one.id, true], [two.id, false]]);

    const page = async () => (await ctx.fns.procs.http.dispatch({ method: "GET", url: `http://localhost/agent/${a.id}` })).text();
    let html = await page();
    expect(html).toContain(`data-canvas-item="${one.id}"`);
    expect(html).toMatch(/<iframe src="\/files\/embed\/[^"]*\/package\.json"/);

    const post = (body: any) => ctx.fns.procs.http.dispatch({ method: "POST", url: `http://localhost/canvas/${a.id}`, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await (await post({ activeItemId: two.id })).json()).activeItemId).toBe(two.id);
    const panel = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: `http://localhost/canvas/${a.id}/panel` })).text();
    expect(panel).toMatch(/<iframe src="\/files\/embed\/[^"]*\/README\.md\?tab=preview"/);

    // The agent sees what is open, active first, with the tab's state.
    await ctx.fns.canvas.setState({ agentId: a.id, itemId: two.id, state: { line: 12 } });
    const block = (await ctx.fns.procs.hooks.run({ name: "agent.promptAugment", opts: { agentId: a.id, text: "" } })).find((b: string) => String(b).includes("## Canvas"));
    expect(block).toContain(`[${two.id}] "README.md": file `);
    expect(block).toContain('(active) — state {"line":12}');

    // Another agent cannot activate this agent's tab.
    const b = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: b });
    expect((await ctx.fns.procs.http.dispatch({ method: "POST", url: `http://localhost/canvas/${b.id}`, headers: { "content-type": "application/json" }, body: JSON.stringify({ activeItemId: one.id }) })).status).toBe(400);

    // Closing the active tab activates its neighbour; closing the last leaves an empty open canvas.
    expect((await (await post({ closeItemId: two.id })).json()).activeItemId).toBe(one.id);
    await ctx.fns.canvas.close({ agentId: a.id, itemId: one.id });
    expect(await ctx.fns.canvas.get({ agentId: a.id })).toMatchObject({ open: true, activeItemId: null });
    html = await page();
    expect(html).toContain("Canvas is empty");
});

test("review: concurrent canvas changes do not lose each other, files resolve in the target agent's workspace", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    // Two identical shows at once make one tab; the path is pinned absolute with an explicit local host.
    const [x, y] = await Promise.all([1, 2].map(() => ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "package.json" } })));
    expect(x.id).toBe(y.id);
    expect(x.args).toMatchObject({ host: "local" });
    expect(x.args.path).toStartWith("/");
    expect((await ctx.fns.canvas.list({ agentId: a.id })).length).toBe(1);
    // Two state patches at once keep both keys.
    await Promise.all([ctx.fns.canvas.setState({ agentId: a.id, itemId: x.id, state: { a: 1 } }), ctx.fns.canvas.setState({ agentId: a.id, itemId: x.id, state: { b: 2 } })]);
    expect((await ctx.fns.canvas.list({ agentId: a.id }))[0].state).toEqual({ a: 1, b: 2 });
    // A width save does not undo a tab switch made meanwhile.
    const z = await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "README.md" } });
    await Promise.all([ctx.fns.canvas.update({ agentId: a.id, activeItemId: x.id }), ctx.fns.canvas.update({ agentId: a.id, chatWidth: 600 })]);
    expect(await ctx.fns.canvas.get({ agentId: a.id })).toMatchObject({ activeItemId: x.id, chatWidth: 600 });
    // Concurrent closes leave a valid active tab (or none).
    await Promise.all([ctx.fns.canvas.close({ agentId: a.id, itemId: x.id }), ctx.fns.canvas.close({ agentId: a.id, itemId: z.id })]);
    expect(await ctx.fns.canvas.get({ agentId: a.id })).toMatchObject({ activeItemId: null });
    // State changes move the panel fingerprint, so open pages refetch.
    const t = await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: "package.json" } });
    const before = await ctx.fns.canvas.revision({ agentId: a.id });
    await ctx.fns.canvas.setState({ agentId: a.id, itemId: t.id, state: { line: 3 } });
    const after = await ctx.fns.canvas.revision({ agentId: a.id });
    expect(after.panel).not.toBe(before.panel);
    expect(after.body).not.toBe(before.body);
});
