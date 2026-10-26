import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import route from "./$route_widget_GET";

test("lazy widget: home draws a placeholder without rendering, GET /nav/widget renders it, then home uses the cached copy", async () => {
    const ctx: any = await mkTestCtx();
    let renders = 0;
    const nav = ((ctx.state as any).nav ??= {});
    nav.widgetCache = new Map();
    nav.widgets = { ...(nav.widgets ?? {}), slow: { id: "slow", module: "test", rel: "x", title: "Slow", ttl: 60, lazy: true, render: async () => { renders++; return [{ id: "s1", label: "slow row", href: "/x" }]; } } };
    const placement = { id: "slow", widget: "slow", size: "M" };
    ctx.fns.nav.tabs = async () => ({ tabs: [{ id: "t", title: "T", widgets: [placement], search: [] }], source: "default" });
    const first: string = await ctx.fns.nav.home({ tab: "t" });
    expect(renders).toBe(0);
    expect(first).toContain('hx-get="/nav/widget?tab=t&amp;id=slow"'.replace("&amp;", "&"));
    expect(first).toContain('class="w-skeleton"');
    const res: Response = await route(ctx, null, { req: new Request("http://x/nav/widget?tab=t&id=slow"), params: {} });
    expect(await res.text()).toContain("slow row");
    expect(renders).toBe(1);
    const second: string = await ctx.fns.nav.home({ tab: "t" });
    expect(second).toContain("slow row");
    expect(second).not.toContain("data-nav-lazy");
    expect(renders).toBe(1);
});
