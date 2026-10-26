// /browser/live — the live view page: one toolbar (w.addressBar: Chrome tabs, back, forward, reload, address,
// type text, quality, status) over a canvas that shows one Chrome tab. Everything in the toolbar is a w widget;
// the tab list, text box and connection details are native popovers (w.popover), so one opens at a time and
// Escape or a click outside closes it. The page's own sheet ($style_live.css) only lays out the stage.
// `?target=<targetId>` picks the tab, `?cdp=<endpoint>` an allowed other Chrome.
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const url = new URL(opts.req.url);
    try {
        await ctx.fns.browser.liveCdp({ requested: url.searchParams.get("cdp") ?? undefined });
    } catch (e: any) {
        return new Response(e.message, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const w = ctx.fns.w;
    const styles = ((ctx.state.procs as any).styles ?? []) as Array<{ href: string }>;
    const sheets = styles.filter(s => s.href === "/w/w.css" || s.href === "/browser/live.css").map(s => `<link rel="stylesheet" href="${s.href}">`).join("");

    // Chrome tabs: the opener shows the current tab's title; live.js fills the list (w.listRow markup).
    const tabsPicker = w.popover({
        id: "lv-tabmenu", label: "Chrome tabs", width: 340,
        trigger: w.button({ label: "Tabs", icon: "browsers", tone: "ghost", size: "sm", title: "Chrome tabs", action: { popover: "lv-tabmenu" }, attrs: { id: "lv-tabs" } }),
        body: w.list({ label: "Chrome tabs", body: w.listRow({ label: "New tab", icon: "plus", tone: "primary", action: { action: "live-new-tab" }, attrs: { "data-live-new": true } }) + `<div id="lv-tablist"></div>` }),
    });
    const paste = w.popover({
        id: "lv-paste", label: "Type text into the page", placement: "below-end", width: 320,
        trigger: w.iconButton({ icon: "keyboard", label: "Type text into the focused field", action: { popover: "lv-paste" }, size: 24, attrs: { id: "lv-insert" } }),
        body: w.box({ mix: { layout: "stack", gap: "s2" }, body:
            w.textarea({ name: "text", id: "lv-paste-text", label: "Text to type into the page", placeholder: "Text to type into the page", rows: 4 })
            + w.box({ mix: { layout: "row", justify: "end" }, body: w.button({ label: "Insert", tone: "primary", size: "sm", attrs: { id: "lv-paste-send" } }) }) }),
    });
    const quality = w.select({ name: "quality", id: "lv-quality", label: "Picture quality: Auto lowers it when frames lag", options: [{ value: "auto", label: "Auto" }, { value: "high", label: "High" }, { value: "low", label: "Low" }] });
    // The status: a dot and a short word; it opens the whole path's health (live.js fills the pairs).
    const status = w.popover({
        id: "lv-info", label: "Connection details", placement: "below-end", width: 340,
        trigger: w.pressable({ html: w.dot({ state: "waiting", label: "connecting" }), title: "Connection details", action: { popover: "lv-info" }, class: "w-btn", attrs: { id: "lv-status", "data-tone": "ghost", "data-size": "sm" } }),
        body: w.box({ mix: { layout: "stack", gap: "s2" }, body: w.box({ body: "Live view", mix: { caption: true } }) + `<div id="lv-info-list">${w.keyValue({ items: [] })}</div>` }),
    });
    const bar = w.addressBar({
        url: "", placeholder: "Address or search", newTab: false, outlined: true,
        start: tabsPicker,
        back: { action: "live-back" }, backAttrs: { id: "lv-back" },
        forward: { action: "live-forward" }, forwardAttrs: { id: "lv-forward" },
        reload: { action: "live-reload" }, reloadAttrs: { id: "lv-reload" },
        end: paste + quality + status,
        attrs: { id: "lv-nav" },
    });
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Live view</title>
<link rel="stylesheet" href="/ui/vendor/phosphor.css">${sheets}
<script>document.documentElement.dataset.wTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';</script>
</head>
<body class="lv">
${bar}
<main><canvas id="lv-screen" tabindex="0" width="800" height="600"></canvas></main>
<script src="/browser/live.js"></script>
</body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN" } });
}
