import { expect, test } from "bun:test";
import kind from "./$canvas_live";
import page from "./page";

// A fake Chrome DevTools endpoint behind global fetch: /json/new opens a tab.
function fakeChrome() {
    const opened: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
        const u = new URL(String(input));
        if (u.pathname === "/json/new" && init?.method === "PUT") {
            opened.push(decodeURIComponent(u.search.slice(1)));
            return Response.json({ id: "T-NEW", type: "page", url: opened.at(-1), title: "" });
        }
        return new Response("no", { status: 404 });
    }) as typeof fetch;
    return { opened, url: "http://127.0.0.1:9", restore: () => { globalThis.fetch = real; } };
}

function fakeCtx(browserUrl: string) {
    const ctx: any = { state: {}, fns: { browser: {}, rpc: {}, procs: { ui: { escape: ({ text }: { text: string }) => Bun.escapeHTML(text) } } } };
    ctx.fns.browser.liveCdp = async () => ({ browserUrl, isDefault: true });
    ctx.fns.browser.liveView = async (o: { tab?: string }) => ({ url: "", targetId: o.tab ?? "T-1", title: "Example", pageUrl: "https://example.com/" });
    ctx.fns.browser.liveBase = async () => "";
    ctx.fns.rpc.frame = (o: { src: string; title: string }) => `<iframe src="${o.src}" title="${o.title}"></iframe>`;
    return ctx as Context;
}

test("browser.live with a url opens it in a new Chrome tab and shows that tab", async () => {
    const chrome = fakeChrome();
    try {
        const ctx = fakeCtx(chrome.url);
        const r = await kind.prepare(ctx, { agentId: "a", args: { url: "www.google.com" } });
        expect(chrome.opened).toEqual(["https://www.google.com"]);
        expect(r).toEqual({ args: { target: "T-NEW" }, title: "google.com" });
        await expect(kind.prepare(ctx, { agentId: "a", args: { url: "javascript:alert(1)" } })).rejects.toThrow("only http(s)");
    } finally { chrome.restore(); }
});

test("browser.live without a url shows an open tab; its body is the live page with no second address bar", async () => {
    const ctx = fakeCtx("http://127.0.0.1:1");
    expect(await kind.prepare(ctx, { agentId: "a", args: { tab: "T-1" } })).toEqual({ args: { target: "T-1" }, title: "Example" });
    const html = await kind.render(ctx, { agentId: "a", item: { args: { target: "T-1" } } as any });
    expect(html).toContain('src="/browser/live?target=T-1"');
    expect(html).not.toContain("data-canvas-navigate");
    expect(kind.view).toBeUndefined();
});

test("browser.page is the same live page at an address", async () => {
    const ctx = fakeCtx("http://127.0.0.1:1");
    expect(await page(ctx, null, { target: "T-1" })).toContain('src="/browser/live?target=T-1"');
    expect(await page(ctx, null, {})).toContain('src="/browser/live"');
});
