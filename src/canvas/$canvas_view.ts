// A view tab: the page of a `@view` function at its address, GET /rpc/<fn>?<json>, drawn into the tab body on the
// server (rpc.render) — opening or switching the tab is the one panel request, no second fetch, no frame (the
// fragment may carry its own iframe when it needs isolated scripts). The address is
// the tab: an address bar, back and forward through the addresses this tab has shown, "open in a new browser
// tab", and /rpc links inside the fragment move the same tab (canvas.js → canvas.navigate).

export const hint = "the page of a `@view` function by its address — args `{ fn, params? }` or `{ url: \"/rpc/<fn>?<json>\" }`; the tab has an address bar, ◀ ▶ and open-in-new-tab, and /rpc links inside it move the tab. canvas.search lists the view functions";

/** Parses `/rpc/<fn>?<json>` (or fn + params) into the canonical { fn, params, url }. */
async function target(ctx: Context, args: Record<string, any>): Promise<{ fn: string; params: Record<string, unknown>; url: string }> {
    let fn = String(args.fn ?? "").trim();
    let params: Record<string, unknown> = args.params && typeof args.params === "object" && !Array.isArray(args.params) ? args.params : {};
    if (!fn && args.url) {
        let u: URL;
        try { u = new URL(String(args.url).trim(), "http://hyper.local"); } catch { throw new Error(`canvas view: not an address: ${args.url}`); }
        const m = /^\/rpc\/([^/]+)$/.exec(u.pathname);
        if (!m) throw new Error(`canvas view: the address must be /rpc/<fn>?<json>, got ${u.pathname}`);
        fn = decodeURIComponent(m[1]!);
        const raw = u.search.slice(1);
        if (raw) {
            // Not percent-encoded (a hand-typed link): read the query as it is.
            const text = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
            if (text.trimStart().startsWith("{")) {
                try { params = JSON.parse(text); } catch { throw new Error("canvas view: the query is not valid JSON"); }
            } else params = Object.fromEntries(new URLSearchParams(raw));
        }
    }
    if (!fn) throw new Error("canvas view: args.fn or args.url is required");
    let meta: Record<string, any>;
    try { meta = ctx.fns.runtime.docs.get({ name: fn }); } catch { throw new Error(`canvas view: no such function ${fn}`); }
    if (!meta.view) throw new Error(`canvas view: ${fn} is not tagged @view`);
    const url = ctx.fns.rpc.url({ fn, params });
    return { fn, params: JSON.parse(ctx.fns.rpc.canonicalJson({ value: params })), url };
}

export default {
    icon: "app-window",
    live: true,
    async prepare(ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const t = await target(ctx, opts.args);
        if (t.fn === "files.page") {
            const name = String(t.params.path ?? "").split("/").filter(Boolean).pop() || String(t.params.path ?? "/");
            return { args: t, title: t.params.host ? `${t.params.host}:${name}` : name };
        }
        const short = Object.values(t.params).filter(v => typeof v === "string" || typeof v === "number").map(String)[0];
        return { args: t, title: short ? `${t.fn.split(".").pop()}: ${short}`.slice(0, 120) : t.fn };
    },
    async render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.w.escape({ text });
        const url = String(opts.item.args.url ?? "");
        // The address bar shows the call as people read it — /rpc/memory.view?{"key":"notes/a.md"} — not
        // percent-encoded; typing either form works (the view kind parses both).
        const q = url.indexOf("?");
        const shown = q < 0 ? url : (() => { try { return url.slice(0, q + 1) + decodeURIComponent(url.slice(q + 1)); } catch { return url; } })();
        const back = Array.isArray(opts.item.state.back) ? opts.item.state.back.length : 0;
        const fwd = Array.isArray(opts.item.state.forward) ? opts.item.state.forward.length : 0;
        const btn = (attr: string, icon: string, label: string, on: boolean) =>
            `<button type="button" ${attr} ${on ? "" : "disabled"} title="${label}" aria-label="${label}" class="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-base-content disabled:opacity-30 disabled:hover:bg-transparent"><i class="ph ph-${icon}" aria-hidden="true"></i></button>`;
        const bar = `<form data-canvas-navigate="${opts.item.id}" data-canvas-navigate-kind="view" class="flex h-9 shrink-0 items-center gap-1 border-b border-ui-border bg-base-100 px-2">
  ${btn(`data-canvas-step="back"`, "arrow-left", "Back", back > 0)}
  ${btn(`data-canvas-step="forward"`, "arrow-right", "Forward", fwd > 0)}
  ${btn("data-canvas-reload", "arrow-clockwise", "Reload page", true)}
  <input name="url" value="${esc(shown)}" spellcheck="false" autocomplete="off" aria-label="Address" class="min-w-0 flex-1 rounded-md bg-base-200/70 px-2 py-1 font-mono text-xs outline-none focus:bg-base-200 focus:ring-1 focus:ring-ui-border">
  <a href="${esc(url)}" target="_blank" rel="noopener" title="Open in a new browser tab" aria-label="Open in a new browser tab" class="flex size-7 shrink-0 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-base-content"><i class="ph ph-arrow-square-out" aria-hidden="true"></i></a>
</form>`;
        const r = await ctx.fns.rpc.render({ url });
        const frag = `<div data-canvas-view="${opts.item.id}" data-rpc-status="${r.status}" class="min-h-0 flex-1 overflow-auto">${r.html}</div>`;
        return `<div class="flex h-full flex-col">${bar}${frag}</div>`;
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        if (a.fn === "files.page") return `file ${a.params?.host ? a.params.host + ":" : ""}${a.params?.path}${a.params?.tab ? ` (${a.params.tab})` : ""}`;
        return `view ${a.url}`;
    },
} satisfies types.canvas.Kind;
