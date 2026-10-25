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
        const frame = (cls: string) => `<iframe src="${esc(url)}" title="${esc(opts.item.title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" data-canvas-url-frame referrerpolicy="no-referrer" allow="fullscreen; clipboard-write" class="${cls} h-full w-full border-0 bg-white"></iframe>`;
        // A small browser chrome: the address (editable — Enter navigates this tab) and "open in a new tab".
        // Reload is the panel's own button. Back/forward inside the site are not ours to drive: the frame is
        // another origin.
        const bar = `<form data-canvas-navigate="${opts.item.id}" data-canvas-url-from="${esc(opened)}" class="flex h-9 shrink-0 items-center gap-1.5 border-b border-ui-border bg-base-100 px-2">
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
  <div class="text-base font-medium">${esc(new URL(opened).hostname)} does not allow embedding in another page</div>
  <div class="max-w-md text-sm text-faint">${esc(String(a.reason ?? ""))}</div>
  <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Open in a new tab</a>
  <div class="mt-4 max-w-md rounded-lg border border-ui-border p-4 text-left text-sm">
    <div class="font-medium">Show such sites right here</div>
    <div class="mt-1 text-faint">Install the Hyper canvas frames extension for Chrome. Inside Hyper tabs only, it lets pages that forbid embedding open in the canvas.</div>
    <ol class="mt-2 list-decimal space-y-0.5 pl-5 text-faint">
      <li><a href="/canvas/framesExtension.zip" download class="link">Download the extension</a> and unzip it.</li>
      <li>Open <code>chrome://extensions</code> and turn on Developer mode.</li>
      <li>Load unpacked → choose the <code>hyper-canvas-frames</code> folder, then reload this page.</li>
    </ol>
    <a href="/canvas/framesExtension.zip" download class="btn btn-sm btn-primary mt-3"><i class="ph ph-download-simple" aria-hidden="true"></i> Download extension</a>
  </div>
</div>`);
        }
        return wrap(frame("block"));
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        const st = opts.item.state ?? {};
        const here = typeof st.url === "string" && st.from === a.url && st.url !== a.url ? `, now at ${st.url}${st.title ? ` (${st.title})` : ""}` : "";
        return `web page ${a.url}${here}${a.embeddable === false ? " (forbids framing — shows a link instead)" : ""}`;
    },
} satisfies types.canvas.Kind;
