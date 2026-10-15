import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const register = (ctx: any, items: Record<string, any>) => {
    const state = (ctx.state.dock ??= {});
    state.items = Object.fromEntries(Object.entries(items).map(([id, def]) => [id, { ...def, id, module: id.split(".")[0], rel: `${id}.ts` }]));
};

test("menu is fixed first, the person fixed last, entries split into top and bottom zones by default", async () => {
    const ctx: any = await mkTestCtx();
    register(ctx, {
        "a.late": { zone: "top", order: 50, icon: "ph-clock", label: "Late", href: "/late" },
        "a.early": { zone: "top", order: 5, icon: "ph-sun", label: "Early", href: "/early" },
        "b.low": { zone: "bottom", order: 1, icon: "ph-gauge", label: "Low", href: "/low" },
    });
    const items = await ctx.fns.dock.items({});
    expect(items.top.map((x: any) => x.id)).toEqual(["a.early", "a.late"]);
    expect(items.bottom.map((x: any) => x.id)).toEqual(["b.low"]);
    const html = await ctx.fns.dock.render({});
    const order = [...html.matchAll(/data-dock-id="([^"]+)"/g)].map(m => m[1]);
    expect(order[0]).toBe("menu");
    expect(order.slice(1)).toEqual(["a.early", "a.late", "b.low"]);
    expect(html.indexOf('id="dock-top"')).toBeLessThan(html.indexOf('id="dock-bottom"'));
    expect(html).toContain('href="/early"');
    expect(html).toContain('title="Early"');
});

test("instance layout reorders, moves between zones and hides; a person's layout replaces it; reset falls back", async () => {
    const ctx: any = await mkTestCtx();
    register(ctx, {
        "x.one": { zone: "top", order: 1, label: "One", href: "/one" },
        "x.two": { zone: "top", order: 2, label: "Two", href: "/two" },
        "x.three": { zone: "bottom", order: 3, label: "Three", href: "/three" },
    });
    await ctx.fns.settings.set({ module: "dock", scopeType: "global", key: "layout", value: JSON.stringify({ top: ["x.three", "x.two", "nope"], hidden: ["x.one"] }) });
    let items = await ctx.fns.dock.items({});
    expect(items.source).toBe("instance");
    expect(items.top.map((x: any) => x.id)).toEqual(["x.three", "x.two"]);
    expect(items.bottom).toEqual([]);
    expect(items.hidden.map((x: any) => x.id)).toEqual(["x.one"]);

    const saved = await ctx.fns.dock.saveLayout({ layout: { bottom: ["x.two", "x.two", "menu", "ghost"], hidden: [] } });
    expect(saved.layout).toEqual({ top: [], bottom: ["x.two"], hidden: [] });
    items = await ctx.fns.dock.items({});
    expect(items.top.map((x: any) => x.id)).toEqual(["x.one"]);
    expect(items.bottom.map((x: any) => x.id)).toEqual(["x.two", "x.three"]);

    await ctx.fns.dock.saveLayout({ reset: true });
    // Without a signed-in person the instance layout itself was the one written and reset.
    items = await ctx.fns.dock.items({});
    expect(items.source).toBe("default");
});

test("a broken or slow entry is left out without breaking the Dock", async () => {
    const ctx: any = await mkTestCtx();
    register(ctx, {
        "p.boom": { render: () => { throw new Error("boom"); } },
        "p.slow": { render: () => new Promise(resolve => setTimeout(() => resolve("<b>late</b>"), 500)) },
        "p.none": { render: () => null },
        "p.ok": { render: () => ({ icon: "ph-envelope", label: "3 unread", href: "/inbox", badge: 3 }) },
    });
    const html = await ctx.fns.dock.render({ timeoutMs: 50 });
    expect(html).toContain('data-dock-id="p.ok"');
    expect(html).toContain('aria-label="3 unread"');
    expect(html).toContain(">3</span>");
    for (const id of ["p.boom", "p.slow", "p.none"]) expect(html).not.toContain(`data-dock-id="${id}"`);
});

test("malformed layout JSON is ignored and the save route validates its body", async () => {
    const ctx: any = await mkTestCtx();
    register(ctx, { "z.a": { label: "A", href: "/a" } });
    await ctx.fns.settings.set({ module: "dock", scopeType: "global", key: "layout", value: "{not json" });
    expect((await ctx.fns.dock.items({})).top.map((x: any) => x.id)).toEqual(["z.a"]);
    const bad = await ctx.fns.procs.http.dispatch({ method: "POST", url: "http://localhost/dock/layout", headers: { "content-type": "application/json" }, body: "[]" });
    expect(bad.status).toBe(400);
    const ok = await ctx.fns.procs.http.dispatch({ method: "POST", url: "http://localhost/dock/layout", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: ["z.a"] }) });
    expect(ok.status).toBe(200);
    expect((await ctx.fns.dock.items({})).hidden.map((x: any) => x.id)).toEqual(["z.a"]);
});

test("the shipped entries load from $dock_ files", async () => {
    const ctx: any = await mkTestCtx();
    const ids = Object.keys(ctx.state.dock?.items ?? {});
    for (const id of ["theme", "mentions.mentions", "update.update", "auth.online", "llms.quota"]) expect(ids).toContain(id);
});
