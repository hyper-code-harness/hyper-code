import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const reg = (ctx: any, items: Record<string, any>) => {
    ctx.state.nav ??= {};
    ctx.state.nav.widgets = Object.fromEntries(Object.entries(items).map(([id, def]) => [id, { ...def, id, module: id.includes(".") ? id.split(".")[0] : "nav", rel: `${id}.ts` }]));
};

test("plugin widgets placed nowhere collect on the built-in Plugins tab; removing one there keeps it away", async () => {
    const ctx: any = await mkTestCtx();
    reg(ctx, {
        chats: { title: "Chats", sizes: ["tall"], render: () => [] },
        "gcal.today": { title: "Today", render: () => [] },
        "inbox.unread": { title: "Unread", sizes: ["S", "M"], render: () => [] },
    });
    let { tabs } = await ctx.fns.nav.tabs({});
    expect(tabs.map((t: any) => t.id)).toEqual(["home", "plugins"]);
    expect(tabs[1].widgets.map((w: any) => [w.widget, w.size])).toEqual([["gcal.today", "M"], ["inbox.unread", "S"]]);

    // Placing a plugin widget on a tab takes it off the Plugins tab.
    let r = await ctx.fns.nav.editLayout({ op: "addTab", title: "Work" });
    expect(r).toEqual({ ok: true, tab: "work" });
    await ctx.fns.nav.editLayout({ op: "add", tab: "work", widget: "gcal.today", size: "wide" });
    ({ tabs } = await ctx.fns.nav.tabs({}));
    expect(tabs.map((t: any) => t.id)).toEqual(["home", "plugins", "work"]);
    expect(tabs[1].widgets.map((w: any) => w.widget)).toEqual(["inbox.unread"]);
    expect(tabs[2].widgets).toEqual([{ id: "gcal.today", widget: "gcal.today", size: "M" }]);

    // Removing the last plugin widget from Plugins hides that tab, and the widget does not come back.
    await ctx.fns.nav.editLayout({ op: "remove", tab: "plugins", id: "inbox.unread" });
    ({ tabs } = await ctx.fns.nav.tabs({}));
    expect(tabs.map((t: any) => t.id)).toEqual(["home", "work"]);
    // Adding it back anywhere clears the hidden mark.
    await ctx.fns.nav.editLayout({ op: "add", tab: "home", widget: "inbox.unread" });
    ({ tabs } = await ctx.fns.nav.tabs({}));
    expect(tabs[0].widgets.map((w: any) => w.widget)).toEqual(["chats", "inbox.unread"]);
});

test("edit ops: move, size, config, rename, move and remove tabs, reset; POST /nav/layout answers with triggers", async () => {
    const ctx: any = await mkTestCtx();
    reg(ctx, {
        chats: { title: "Chats", sizes: ["tall", "M"], render: () => [] },
        pages: { title: "Pages", sizes: ["tall", "M"], render: () => [] },
    });
    await ctx.fns.nav.editLayout({ op: "move", tab: "home", id: "pages", dir: -1 });
    await ctx.fns.nav.editLayout({ op: "size", tab: "home", id: "chats", size: "M" });
    await ctx.fns.nav.editLayout({ op: "config", tab: "home", id: "chats", config: { limit: 5 } });
    let home = (await ctx.fns.nav.tabs({})).tabs[0];
    expect(home.widgets).toEqual([{ id: "pages", widget: "pages", size: "tall" }, { id: "chats", widget: "chats", size: "M", config: { limit: 5 } }]);
    expect((await ctx.fns.nav.editLayout({ op: "move", tab: "home", id: "pages", dir: -1 })).ok).toBe(false);

    await ctx.fns.nav.editLayout({ op: "addTab", title: "Здоровье" });
    let tabs = (await ctx.fns.nav.tabs({})).tabs;
    const own = tabs.at(-1);
    expect(own.title).toBe("Здоровье");
    await ctx.fns.nav.editLayout({ op: "renameTab", tab: own.id, title: "Health" });
    await ctx.fns.nav.editLayout({ op: "moveTab", tab: own.id, dir: -1 });
    tabs = (await ctx.fns.nav.tabs({})).tabs;
    expect(tabs.map((t: any) => t.title)).toEqual(["Health", "Home"]);
    expect((await ctx.fns.nav.editLayout({ op: "removeTab", tab: "home" })).ok).toBe(true);
    expect((await ctx.fns.nav.tabs({})).tabs.map((t: any) => t.title)).toEqual(["Health"]);
    expect((await ctx.fns.nav.editLayout({ op: "removeTab", tab: own.id })).error).toBe("the last tab stays");

    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/nav/layout", body: new URLSearchParams({ op: "reset" }) });
    expect(res.status).toBe(200);
    expect(Object.keys(JSON.parse(res.headers.get("HX-Trigger")!))).toEqual(["nav-refresh"]);
    expect((await ctx.fns.nav.tabs({})).tabs.map((t: any) => t.id)).toEqual(["home"]);
    const added = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/nav/layout", body: new URLSearchParams({ op: "addTab", title: "Work" }) });
    expect(Object.keys(JSON.parse(added.headers.get("HX-Trigger")!))).toEqual(["nav-tab"]);
    expect((await ctx.fns.procs.http.dispatch({ method: "POST", url: "/nav/layout", body: new URLSearchParams({ op: "nope" }) })).status).toBe(400);

    const html = await ctx.fns.nav.home({ tab: "home", edit: true });
    expect(html).toContain("data-nav-edit-controls");
    expect(html).toContain("data-nav-add");
    expect(html).toContain('name="op" value="remove"');
    expect(await ctx.fns.nav.home({ tab: "home" })).not.toContain("data-nav-edit-controls");
});
