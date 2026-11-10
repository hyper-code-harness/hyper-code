import { test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// ui.newAgentActions: no answer → /agent/new (page and popup) and the Chats /
// Recent widgets render exactly as before; answers become buttons and rows;
// broken items and handlers are dropped. One test: hook registrations are
// process-global.
test("ui.newAgentActions: silence changes nothing, answers show everywhere", async () => {
    const ctx: any = await mkTestCtx();
    const route = ctx.state.procs.http.routes["/agent/new"].GET;
    const page = async () => JSON.stringify(await route(ctx, null, { req: new Request("http://localhost/agent/new"), params: {} }));
    const popup = async () => (await route(ctx, null, { req: new Request("http://localhost/agent/new?popup=1"), params: {} }) as Response).text();
    const widgetItems = async (name: string) => (await ctx.state.nav.widgets[name].render(ctx, null, { size: "L", config: {} })).items;

    const handlers = (ctx.state.procs.hooks.handlers ??= {});
    const saved = handlers["ui.newAgentActions"];
    try {
        delete handlers["ui.newAgentActions"];
        const [page0, popup0, chats0, recent0] = await Promise.all([page(), popup(), widgetItems("chats"), widgetItems("recent")]);
        expect(await ctx.fns.ui.newAgentActions({})).toEqual([]);
        expect(ctx.fns.ui.newAgentActionsHtml({ items: [] })).toBe("");

        // Silent answers: identical output.
        handlers["ui.newAgentActions"] = new Map<string, Function>([["quiet", () => []], ["undef", () => undefined]]);
        expect(await page()).toBe(page0);
        expect(await popup()).toBe(popup0);
        expect(await widgetItems("chats")).toEqual(chats0);
        expect(await widgetItems("recent")).toEqual(recent0);

        handlers["ui.newAgentActions"] = new Map<string, Function>([
            ["support", () => [
                { id: "support", label: "New support chat", icon: "ph-headset", href: "/support/new" },
                { id: "wizard", label: "Wizard", fn: "support.wizardPopup" },
                { id: "bad-both", label: "Both", href: "/x", fn: "a.b" },
                { id: "bad-none", label: "None" },
                { id: "bad-href", label: "Evil", href: "javascript:alert(1)" },
            ]],
            ["broken", () => { throw new Error("boom"); }],
            ["dupe", () => [{ id: "support", label: "Second", href: "/y" }]],
        ]);
        const items = await ctx.fns.ui.newAgentActions({});
        expect(items).toEqual([
            { id: "support", label: "New support chat", icon: "ph-headset", href: "/support/new" },
            { id: "wizard", label: "Wizard", fn: "support.wizardPopup" },
        ]);

        const page1 = await page();
        const popup1 = await popup();
        for (const html of [page1, popup1]) {
            expect(html).toContain("data-new-agent-actions");
            expect(html).toContain("New support chat");
            expect(html).toContain("/support/new");
            expect(html).toContain("support.wizardPopup");
        }
        const chats1 = await widgetItems("chats");
        expect(chats1[0]).toEqual(chats0[0]);
        expect(chats1.slice(1)).toEqual([
            { id: "chats:quick:support", label: "New support chat", href: "/support/new", icon: "ph-headset", action: true },
            { id: "chats:quick:wizard", label: "Wizard", href: "/agent/new", icon: "ph-plus", action: true },
        ]);
        expect((await widgetItems("recent")).map((i: any) => i.id)).toEqual(["recent:new", "recent:quick:support", "recent:quick:wizard"]);
    } finally {
        if (saved) handlers["ui.newAgentActions"] = saved; else delete handlers["ui.newAgentActions"];
    }
});
