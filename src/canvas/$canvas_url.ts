// A url tab: a live web page in an iframe. Many sites forbid being framed (X-Frame-Options or CSP
// frame-ancestors); the browser then shows an empty frame, so the tab checks the headers when it is opened
// and shows a plain notice with an "open in a new tab" link instead.

export const hint = "a web page by address — args `{ url }` (http/https), live in a frame; sites that forbid framing (Google, GitHub, most logins) show a notice with a link to open them in a new browser tab instead, unless the person's Chrome has the Hyper canvas frames extension, which lets them show live too. For such a site, or to work in it together, open the `browser.live` kind instead (a live tab of the shared Chrome)";

/** Reads the response headers of the page and says whether a foreign page may frame it. */
async function framing(url: string): Promise<{ embeddable: boolean; reason?: string; finalUrl: string }> {
    const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142 Safari/537.36", accept: "text/html,*/*" },
    });
    res.body?.cancel().catch(() => undefined);
    const xfo = (res.headers.get("x-frame-options") ?? "").trim();
    const csp = res.headers.get("content-security-policy") ?? "";
    const ancestors = csp.split(";").map((d) => d.trim()).find((d) => /^frame-ancestors\b/i.test(d));
    if (ancestors && !/\s\*(\s|$)/.test(ancestors)) return { embeddable: false, reason: `CSP ${ancestors}`, finalUrl: res.url || url };
    if (xfo && !ancestors) return { embeddable: false, reason: `X-Frame-Options: ${xfo}`, finalUrl: res.url || url };
    return { embeddable: true, finalUrl: res.url || url };
}

export default {
    icon: "browser",
    live: true,
    // The extension reports the frame's address into the tab state (url, title, from); the running frame
    // must stay, so a state change is delivered, not re-rendered.
    liveState: true,
    async prepare(_ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        let raw = String(opts.args.url ?? "").trim();
        if (!raw) throw new Error("canvas url: args.url is required");
        if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw;
        let url: URL;
        try { url = new URL(raw); } catch { throw new Error(`canvas url: not a valid address: ${raw}`); }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("canvas url: only http and https addresses");
        const check = await framing(url.href).catch((e: any) => ({ embeddable: true, reason: `not checked: ${String(e?.message ?? e)}`, finalUrl: url.href }));
        return {
            args: { url: url.href, embeddable: check.embeddable, ...(check.reason ? { reason: check.reason } : {}) },
            title: url.hostname.replace(/^www\./, ""),
        };
    },
    render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.w.escape({ text });
        const a = opts.item.args;
        const opened = String(a.url ?? "");
        // Where the person went inside the site (reported by the canvas-frames extension) — while the tab
        // still points at the address it was opened with; a new address from the bar or the agent wins.
        const st = opts.item.state ?? {};
        const url = typeof st.url === "string" && st.from === opened && /^https?:\/\//.test(st.url) ? st.url : opened;
        // Separate origin, so allow-same-origin only lets the site keep its own cookies and storage; no
        // allow-top-navigation, so a frame-busting script cannot take the app page away.
        const w = ctx.fns.w;
        const frame = (hook: Record<string, boolean>) => `<iframe src="${esc(url)}" title="${esc(opts.item.title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" data-canvas-url-frame${Object.keys(hook).map(k => ` ${k}`).join("")} referrerpolicy="no-referrer" allow="fullscreen; clipboard-write"></iframe>`;
        // A small browser chrome: the address (editable — Enter navigates this tab) and "open in a new tab".
        // Back/forward inside the site are not ours to drive: the frame is another origin.
        const bar = w.addressBar({ url, secure: url.startsWith("https:"), steps: false, attrs: { "data-canvas-navigate": opts.item.id, "data-canvas-url-from": opened }, reload: { action: "reload-canvas-tab" }, reloadAttrs: { "data-canvas-reload": true } });
        const wrap = (inner: string) => w.pane({ header: bar, body: inner });
        if (a.embeddable === false) {
            // The site forbids framing. With the Hyper canvas frames extension (it marks <html data-hyper-frames>)
            // the frame shows anyway; without it, a notice says why and how to get the extension.
            const steps = w.list({ body: [
                w.listRow({ label: "Download the extension and unzip it", icon: "download-simple", action: { href: "/canvas/framesExtension.zip" } }),
                w.listRow({ label: "Open chrome://extensions and turn on Developer mode", icon: "toggle-right" }),
                w.listRow({ label: "Load unpacked → the hyper-canvas-frames folder, then reload this page", icon: "folder-open" }),
            ].join("") });
            const help = w.card({ title: "Show such sites right here", icon: "puzzle-piece", body: w.box({ body: w.box({ body: "Install the Hyper canvas frames extension for Chrome. Inside Hyper tabs only, it lets pages that forbid embedding open in the canvas.", mix: { ink: "muted" } }) + steps, mix: { layout: "stack", gap: "s2" } }) });
            const notice = w.box({ mix: { layout: "stack", gap: "s4", align: "center", pad: "s6" }, body:
                w.empty({ icon: "prohibit", title: `${new URL(opened).hostname} does not allow embedding in another page`, hint: String(a.reason ?? ""), action: w.button({ label: "Open in a new tab", icon: "arrow-square-out", action: { href: url } }) })
                + help });
            return wrap(frame({ "data-needs-frames": true }) + `<div data-frames-notice>${notice}</div>`);
        }
        return wrap(frame({}));
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        const st = opts.item.state ?? {};
        const here = typeof st.url === "string" && st.from === a.url && st.url !== a.url ? `, now at ${st.url}${st.title ? ` (${st.title})` : ""}` : "";
        return `web page ${a.url}${here}${a.embeddable === false ? " (forbids framing — shows a link instead)" : ""}`;
    },
} satisfies types.canvas.Kind;
