import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import loadWidget from "./$loader_widget";
import loadSearch from "./$loader_search";


test("loaders register widgets and search sources under <module>.<name> and reject bad declarations", async () => {
    const ctx: any = await mkTestCtx();
    const mod = (def: any) => ({ default: def });
    await loadWidget(ctx, null, { entries: [
        { name: "today", moduleDir: "gcal", rel: "gcal/$widget_today.ts", mod: mod({ title: "Today", icon: "ph-calendar", sizes: ["S", "wide"], render: () => [] }) },
        { name: "chats", moduleDir: "nav", rel: "nav/$widget_chats.ts", mod: mod({ title: "Chats", render: () => "<b>x</b>" }) },
    ] });
    expect(Object.keys(ctx.state.nav.widgets)).toEqual(expect.arrayContaining(["chats", "gcal.today"]));
    expect(ctx.state.nav.widgets["gcal.today"].module).toBe("gcal");

    await expect(loadWidget(ctx, null, { entries: [{ name: "x", moduleDir: "a", rel: "a/$widget_x.ts", mod: mod({ title: "X", sizes: ["XL"], render: () => null }) }] })).rejects.toThrow(/sizes/);
    await expect(loadWidget(ctx, null, { entries: [{ name: "x", moduleDir: "a", rel: "a/$widget_x.ts", mod: mod({ title: "X" }) }] })).rejects.toThrow(/render/);

    await loadSearch(ctx, null, { entries: [{ name: "people", moduleDir: "knowledge", rel: "knowledge/$search_people.ts", mod: mod({ title: "People", prefix: "@", search: () => [] }) }] });
    expect(ctx.state.nav.search["knowledge.people"].prefix).toBe("@");
    await expect(loadSearch(ctx, null, { entries: [{ name: "p", moduleDir: "a", rel: "a/$search_p.ts", mod: mod({ title: "P", prefix: "ab", search: () => [] }) }] })).rejects.toThrow(/prefix/);

});

test("tabs: built-in home, layout overrides and own tabs, unknown widgets dropped, sizes clamped, search filtered", async () => {
    const ctx: any = await mkTestCtx();
    const reg = (kind: string, items: Record<string, any>) => {
        ctx.state.nav ??= {};
        ctx.state.nav[kind] = Object.fromEntries(Object.entries(items).map(([id, def]) => [id, { ...def, id, module: id.includes(".") ? id.split(".")[0] : "nav", rel: `${id}.ts` }]));
    };
    reg("widgets", { chats: { title: "Chats", sizes: ["tall", "M"], render: () => [] }, pages: { title: "Pages", render: () => [] }, "gcal.today": { title: "Today", render: () => [] } });
    reg("search", { chats: { title: "Chats", search: () => [] }, "knowledge.people": { title: "People", search: () => [] } });
    let r = await ctx.fns.nav.tabs({});
    expect(r.source).toBe("default");
    expect(r.tabs.map((t: any) => t.id)).toEqual(["home", "plugins"]);
    expect(r.tabs[1].widgets.map((w: any) => w.widget)).toEqual(["gcal.today"]);
    // Core widgets that are not loaded (shared, projects) drop out; a size the widget lacks falls back to its first.
    expect(r.tabs[0].widgets).toEqual([{ id: "chats", widget: "chats", size: "tall" }, { id: "pages", widget: "pages", size: "M" }]);
    expect(r.tabs[0].search).toEqual(["chats", "knowledge.people"]);

    await ctx.fns.settings.set({ module: "nav", scopeType: "global", key: "layout", value: JSON.stringify({
        tabs: [
            { id: "work", title: "Work", widgets: [{ id: "t", widget: "gcal.today", size: "M" }, { id: "t", widget: "gcal.today" }, { id: "x", widget: "ghost" }], search: ["knowledge.people", "nope"] },
            { id: "home", title: "Start" },
            { id: "untitled" },
        ],
        searchHidden: ["chats"],
    }) });
    r = await ctx.fns.nav.tabs({});
    expect(r.source).toBe("instance");
    expect(r.tabs.map((t: any) => [t.id, t.title])).toEqual([["work", "Work"], ["home", "Start"]]); // gcal.today is placed on work, so no plugins tab
    expect(r.tabs[0].widgets).toEqual([{ id: "t", widget: "gcal.today", size: "M" }, { id: "t-2", widget: "gcal.today", size: "M" }]);
    expect(r.tabs[0].search).toEqual(["knowledge.people"]);
    expect(r.tabs[1].widgets.length).toBe(2);
    expect(r.tabs[1].search).toEqual(["knowledge.people"]);

    await ctx.fns.settings.set({ module: "nav", scopeType: "global", key: "layout", value: JSON.stringify({ tabs: [{ id: "mine", title: "Mine" }], hidden: ["home"] }) });
    expect((await ctx.fns.nav.tabs({})).tabs.map((t: any) => t.id)).toEqual(["plugins", "mine"]);

    const saved = await ctx.fns.nav.saveLayout({ layout: { tabs: [{ id: "home" }, { id: "home" }, { id: "untitled" }, { id: "mine", title: "Mine", widgets: [{ widget: "gcal.today" }, { widget: "gcal.today", size: "XL" }, { widget: "ghost" }] }], hidden: ["home", "ghost"], searchHidden: ["nope", "chats"] } as any });
    expect(saved.layout).toEqual({ version: 1, tabs: [{ id: "home" }, { id: "mine", title: "Mine", widgets: [{ id: "gcal.today", widget: "gcal.today" }, { id: "gcal.today-2", widget: "gcal.today" }] }], hidden: ["home"], widgetsHidden: [], searchHidden: ["chats"] });
    await ctx.fns.nav.saveLayout({ reset: true });
    expect((await ctx.fns.nav.tabs({})).source).toBe("default");
});
