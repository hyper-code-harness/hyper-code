// A url tab: a live web page in an iframe. Many sites forbid being framed (X-Frame-Options or CSP
// frame-ancestors); the browser then shows an empty frame, so the tab checks the headers when it is opened
// and shows a plain notice with an "open in a new tab" link instead.

export const hint = "a web page by address — args `{ url }` (http/https), live in a frame; sites that forbid framing (Google, GitHub, most logins) show a notice with a link to open them in a new browser tab instead, unless the person's Chrome has the Hyper canvas frames extension, which lets them show live too";

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
    icon: "globe",
    live: true,
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
        const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
        const a = opts.item.args;
        const url = String(a.url ?? "");
        // Separate origin, so allow-same-origin only lets the site keep its own cookies and storage; no
        // allow-top-navigation, so a frame-busting script cannot take the app page away.
        const frame = (cls: string) => `<iframe src="${esc(url)}" title="${esc(opts.item.title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" referrerpolicy="no-referrer" allow="fullscreen; clipboard-write" class="${cls} h-full w-full border-0 bg-white"></iframe>`;
        // A small browser chrome: the address (editable — Enter navigates this tab) and "open in a new tab".
        // Reload is the panel's own button. Back/forward inside the site are not ours to drive: the frame is
        // another origin.
        const bar = `<form data-canvas-navigate="${opts.item.id}" class="flex h-9 shrink-0 items-center gap-1.5 border-b border-ui-border bg-base-100 px-2">
  <button type="button" data-canvas-reload title="Reload page" aria-label="Reload page" class="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-base-content"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button>
  <i class="ph ph-${url.startsWith("https:") ? "lock-simple" : "globe"} shrink-0 text-faint" aria-hidden="true"></i>
  <input name="url" value="${esc(url)}" spellcheck="false" autocomplete="off" aria-label="Address" class="min-w-0 flex-1 rounded-md bg-base-200/70 px-2 py-1 text-xs outline-none focus:bg-base-200 focus:ring-1 focus:ring-ui-border">
  <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open in a new browser tab" aria-label="Open in a new browser tab" class="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-base-content"><i class="ph ph-arrow-square-out" aria-hidden="true"></i></a>
</form>`;
        const wrap = (inner: string) => `<div class="flex h-full flex-col">${bar}<div class="relative min-h-0 flex-1">${inner}</div></div>`;
        if (a.embeddable === false) {
            // With the canvas-frames extension (extensions/canvas-frames) the browser drops the framing
            // headers inside Hyper tabs and marks <html data-hyper-frames>; then the frame shows and the
            // notice hides. Without it only the notice is visible.
            return wrap(`<style>.hyper-url-frame{display:none}html[data-hyper-frames] .hyper-url-frame{display:block}html[data-hyper-frames] .hyper-url-notice{display:none}</style>
${frame("hyper-url-frame")}
<div class="hyper-url-notice flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
  <div class="text-base font-medium">${esc(new URL(url).hostname)} does not allow embedding in another page</div>
  <div class="max-w-md text-sm text-faint">${esc(String(a.reason ?? ""))}</div>
  <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Open in a new tab</a>
  <div class="max-w-md text-xs text-faint">To open these sites here, install the Hyper canvas frames extension (extensions/canvas-frames directory).</div>
</div>`);
        }
        return wrap(frame("block"));
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        return `web page ${a.url}${a.embeddable === false ? " (forbids framing — shows a link instead)" : ""}`;
    },
} satisfies types.canvas.Kind;
