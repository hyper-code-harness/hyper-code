// The Dock's side panel marks the chat open in the asking tab: the server reads the page address htmx sends.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import route from "./$route_panel_GET";

async function panelCtx() {
    const ctx: any = await mkTestCtx();
    const nav = ((ctx.state as any).nav ??= {});
    nav.widgetCache = new Map();
    nav.widgets = { ...(nav.widgets ?? {}), chatsT: { id: "chatsT", module: "test", rel: "x", title: "Chats", ttl: 60, render: async () => [
        { id: "agent:aa", label: "First", href: "/agent/aa" },
        { id: "agent:bb", label: "Second", href: "/agent/bb" },
    ] } };
    ctx.fns.dock.panelWidgets = async () => ({ widgets: [{ id: "p", widget: "chatsT", size: "tall" }] });
    return ctx;
}
const ask = async (ctx: any, page?: string) => {
    const req = new Request("http://x/dock/panel", { headers: page ? { "hx-current-url": page } : {} });
    return await (await route(ctx, null, { req, params: {} })).text();
};
const currentRows = (html: string) => [...html.matchAll(/<a class="w-row" aria-current="page"[^>]*data-nav-id="([^"]+)"/g)].map(m => m[1]);

test("the row of the chat open in the asking tab is current, and only that one", async () => {
    const ctx = await panelCtx();
    expect(currentRows(await ask(ctx, "http://x/agent/bb"))).toEqual(["agent:bb"]);
    // the ttl cache must not hand one tab's mark to another
    expect(currentRows(await ask(ctx, "http://x/agent/aa"))).toEqual(["agent:aa"]);
});

test("no chat open (another page, no header, a chat's subpage) → no current row", async () => {
    const ctx = await panelCtx();
    expect(currentRows(await ask(ctx, "http://x/settings"))).toEqual([]);
    expect(currentRows(await ask(ctx))).toEqual([]);
    expect(currentRows(await ask(ctx, "http://x/agent/aa/files"))).toEqual([]);
});
