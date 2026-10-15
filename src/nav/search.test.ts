import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const reg = (ctx: any, items: Record<string, any>) => {
    ctx.state.nav ??= {};
    ctx.state.nav.search = Object.fromEntries(Object.entries(items).map(([id, def]) => [id, { ...def, id, module: id.split(".")[0], rel: `${id}.ts` }]));
};
const row = (label: string) => ({ id: `t:${label}`, label, href: `/x/${label}` });

test("search asks sources in parallel, groups by source order, isolates failures and honours prefixes", async () => {
    const ctx: any = await mkTestCtx();
    let seen = "";
    reg(ctx, {
        "a.people": { title: "People", prefix: "@", order: 1, search: ({}, _s: any, o: any) => { seen = o.q; return [row(`p-${o.q}`)]; } },
        "b.boom": { title: "Boom", order: 2, search: () => { throw new Error("boom"); } },
        "c.none": { title: "None", order: 3, search: () => [] },
        "d.docs": { title: "Docs", order: 0, search: (_c: any, _s: any, o: any) => [row(`d-${o.q}`), row("d2")].slice(0, o.limit) },
    });
    let r = await ctx.fns.nav.searchAll({ q: "ann", limit: 1 });
    expect(r.groups.map((g: any) => g.id)).toEqual(["d.docs", "a.people", "b.boom", "c.none"]);
    expect(r.groups[0].items.map((i: any) => i.label)).toEqual(["d-ann"]);
    expect(r.groups[2].error).toBe("boom");
    expect(r.html).toContain('data-nav-group="b.boom"');
    expect(r.html).toContain("unavailable");
    expect(r.html).not.toContain('data-nav-group="c.none"');
    expect(r.html).toContain('data-nav-id="t:p-ann"');

    r = await ctx.fns.nav.searchAll({ q: "@ ann" });
    expect(r.groups.map((g: any) => g.id)).toEqual(["a.people"]);
    expect(seen).toBe("ann");
});

test("a slow source gets a placeholder filled from /nav/group/:token; a source past its budget is aborted", async () => {
    const ctx: any = await mkTestCtx();
    let aborted = false;
    reg(ctx, {
        fast: { title: "Fast", search: () => [row("f")] },
        slow: { title: "Slow", search: async () => { await Bun.sleep(150); return [row("s")]; } },
        stuck: { title: "Stuck", search: (_c: any, _s: any, o: any) => new Promise(() => { o.signal.addEventListener("abort", () => { aborted = true; }); }) },
    });
    const r = await ctx.fns.nav.searchAll({ q: "x", inlineMs: 50, timeoutMs: 400 });
    expect(r.groups.map((g: any) => g.id)).toEqual(["fast"]);
    expect(r.pending.sort()).toEqual(["slow", "stuck"]);
    const token = /hx-get="\/nav\/group\/([^"]+)"[^>]*>.{0,200}Slow/.exec(r.html)?.[1] ?? /data-nav-group="slow"[^>]*hx-get="\/nav\/group\/([^"]+)"/.exec(r.html)?.[1];
    expect(token).toBeTruthy();
    const late = await ctx.fns.procs.http.dispatch({ url: `/nav/group/${token}` });
    const html = await late.text();
    expect(html).toContain('data-nav-id="t:s"');
    expect(html).not.toContain("hx-get");
    // The token is single-use.
    expect(await (await ctx.fns.procs.http.dispatch({ url: `/nav/group/${token}` })).text()).toBe("");
    await Bun.sleep(450);
    expect(aborted).toBe(true);
});

test("GET /nav/items draws the tab grid for an empty query and search groups otherwise", async () => {
    const ctx: any = await mkTestCtx();
    const home = await (await ctx.fns.procs.http.dispatch({ url: "/nav/items" })).text();
    for (const w of ["chats", "shared", "pages", "projects"]) expect(home).toContain(`data-nav-widget="${w}"`);
    expect(home).toContain("New agent");
    reg(ctx, { only: { title: "Only", search: (_c: any, _s: any, o: any) => [row(o.q)] } });
    const found = await (await ctx.fns.procs.http.dispatch({ url: "/nav/items?q=zz" })).text();
    expect(found).toContain('data-nav-group="only"');
    expect(found).toContain('data-nav-id="t:zz"');
});
