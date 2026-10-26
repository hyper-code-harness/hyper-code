// The shared browser on the canvas: one tab of the real Chrome (CDP), live. A kind of its own, not a view
// alias: the live page brings its own toolbar (Chrome tabs, back, forward, address), so the canvas adds no second
// address bar — one browser, one set of controls. Opening it with a url opens that url in a new Chrome tab first,
// so a site that forbids framing still shows.
export const hint = 'one tab of the shared Chrome, live, that the person can click and type in — args `{ url?, tab? }`: `url` opens it in a new Chrome tab, `tab` is a named browser session or target id; without both the most recent tab. Use for sites that forbid framing (Google, GitHub, sign-in) and to show what browser.* is doing';

export default {
    icon: "browser",
    live: true,
    async prepare(ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const { browserUrl } = await ctx.fns.browser.liveCdp({});
        const url = typeof opts.args.url === "string" ? opts.args.url.trim() : "";
        if (url) {
            const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
            if (!/^https?:\/\//i.test(href)) throw new Error(`browser.live: only http(s) addresses, got ${url}`);
            const res = await fetch(`${browserUrl}/json/new?${encodeURIComponent(href)}`, { method: "PUT", signal: AbortSignal.timeout(5000) }).catch(() => null);
            if (!res?.ok) throw new Error(`Chrome DevTools is not reachable at ${browserUrl}`);
            const t: any = await res.json();
            return { args: { target: String(t.id) }, title: new URL(href).hostname.replace(/^www\./, "") };
        }
        const live = await ctx.fns.browser.liveView({ tab: typeof opts.args.tab === "string" ? opts.args.tab : undefined });
        return { args: { target: live.targetId }, title: live.title || "Browser" };
    },
    render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const target = String(opts.item.args?.target ?? "");
        const src = `/browser/live${target ? `?${new URLSearchParams({ target })}` : ""}`;
        return `<iframe src="${Bun.escapeHTML(src)}" title="Live browser"></iframe>`;
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        return `live Chrome tab ${String(opts.item.args?.target ?? "").slice(0, 8)} — ${opts.item.title}`;
    },
} satisfies types.canvas.Kind;
