/**
 * Renders the canvas work surface shown left of an agent's chat.
 *
 * The panel is always in the agent page; the page's data-canvas-open attribute shows or hides it, so
 * toggling never re-renders the chat (drafts, scroll and streaming stay put). Tabs come from canvas.list;
 * the active tab's body is drawn by its kind (canvas catalog). A kind that fails to render shows its error
 * in the body instead of breaking the agent page.
 * @param opts.agentId Agent whose canvas to render.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose canvas to render. */
        agentId: string;
    },
): Promise<string> {
    const id = ctx.fns.procs.ui.escape({ text: opts.agentId });
    const close = ctx.fns.procs.ui.button({
        action: "close-canvas",
        html: '<i class="ph ph-x" aria-hidden="true"></i>',
        appearance: "plain",
        ariaLabel: "Close canvas",
        class: "flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition hover:bg-base-200 hover:text-base-content",
        title: "Close canvas",
        attrs: { "data-canvas-toggle": "close" },
    });
    // Reload draws the active tab again from its source: a file re-read, a site re-fetched, an html page's
    // load re-run, a tsx drawing recomputed. canvas.js asks for the panel and swaps the body unconditionally.
    const reload = ctx.fns.procs.ui.button({
        action: "reload-canvas-tab",
        html: '<i class="ph ph-arrow-clockwise" aria-hidden="true"></i>',
        appearance: "plain",
        ariaLabel: "Reload tab",
        class: "flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition hover:bg-base-200 hover:text-base-content",
        title: "Reload tab",
        attrs: { "data-canvas-reload": "" },
    });
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    const items = await ctx.fns.canvas.list({ agentId: opts.agentId }).catch(() => [] as types.canvas.Item[]);
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    const active = items.find(i => i.active) ?? null;
    const closed = await ctx.fns.canvas.list({ agentId: opts.agentId, closed: true, limit: 15 }).catch(() => [] as types.canvas.Item[]);
    const now = Date.now();
    const ago = (ms: number) => {
        const s = Math.max(0, Math.round((now - ms) / 1000));
        if (s < 60) return "just now";
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
        return `${Math.round(s / 86_400)} d ago`;
    };
    const stamp = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    // Recently closed: closing only marks a tab, so it can come back with its state (kept 30 days).
    const history = closed.length ? `<details class="canvas-history relative flex items-center border-b border-l border-ui-border px-1" data-canvas-history>
      <summary class="flex size-7 cursor-pointer list-none items-center justify-center rounded-full text-faint transition hover:bg-base-200 hover:text-base-content [&::-webkit-details-marker]:hidden" title="Recently closed tabs" aria-label="Recently closed tabs"><i class="ph ph-clock-counter-clockwise" aria-hidden="true"></i></summary>
      <div class="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-ui-border bg-base-100 py-1 text-xs shadow-lg">
        <div class="px-3 py-1.5 text-3xs font-semibold uppercase tracking-wide text-faint">Recently closed</div>
        ${closed.map(item => `<button type="button" class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-base-200" data-canvas-reopen="${item.id}" title="Opened ${esc(stamp(item.createdAt))} · closed ${esc(stamp(item.closedAt ?? now))}"><i class="ph ph-${esc(kinds[item.kind]?.icon ?? "square")} shrink-0 text-faint" aria-hidden="true"></i><span class="min-w-0 flex-1 truncate">${esc(item.title)}</span><span class="shrink-0 text-faint">${esc(ago(item.closedAt ?? now))}</span></button>`).join("")}
      </div>
    </details>` : "";
    const rev = await ctx.fns.canvas.revision({ agentId: opts.agentId });
    const tabs = items.map(item => {
        const icon = kinds[item.kind]?.icon ?? "square";
        // macOS Finder tabs: equal-width segments across the strip divided by hairlines, centred title,
        // the active one is lighter and joins the body, inactive ones are a darker grey; close on the right, on hover and on the active tab.
        return `<div class="canvas-tab group relative flex min-w-24 flex-1 basis-0 cursor-pointer select-none items-center justify-center border-l border-ui-border px-6 first:border-l-0 ${item.active ? "bg-base-100 text-base-content" : "border-b bg-base-300/60 text-muted hover:bg-base-300"}" data-canvas-tab="${item.id}"${item.active ? ' aria-current="true"' : ""}>
      <button type="button" class="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-faint ${item.active ? "opacity-60" : "opacity-0"} hover:bg-base-300 hover:text-base-content hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100" data-canvas-close-item="${item.id}" title="Close tab" aria-label="Close ${esc(item.title)}"><i class="ph ph-x text-3xs" aria-hidden="true"></i></button>
      <button type="button" class="flex min-w-0 items-center gap-1.5" data-canvas-select="${item.id}" title="${esc(item.title)} · opened ${esc(stamp(item.createdAt))}"><i class="ph ph-${esc(icon)} shrink-0 text-faint" aria-hidden="true"></i><span class="truncate">${esc(item.title)}</span></button>
    </div>`;
    }).join("");
    let body: string;
    if (!active) {
        body = `<div class="flex h-full items-center justify-center"><div class="max-w-sm px-6 text-center text-faint">
      <i class="ph ph-square-half text-4xl" aria-hidden="true"></i>
      <p class="mt-2 text-sm font-medium text-muted">Canvas is empty</p>
      <p class="mt-1 text-xs">Files, images, documents and diagrams opened by you or the agent will appear here.</p>
    </div></div>`;
    } else {
        const kind = kinds[active.kind];
        try {
            if (!kind) throw new Error(`canvas kind "${active.kind}" is not loaded`);
            body = await kind.render(ctx, { agentId: opts.agentId, item: active });
        } catch (error: any) {
            body = `<div class="flex h-full items-center justify-center p-6 text-sm text-faint">${esc(String(error?.message ?? error))}</div>`;
        }
    }
    return `<section id="canvas-panel" data-canvas-panel data-agent-id="${id}" data-canvas-rev="${rev.panel}" aria-label="Canvas" class="canvas-panel glass-panel my-2 ml-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ui-border">
  <header class="flex h-8 shrink-0 items-stretch bg-base-300/60 text-xs">
    <nav data-canvas-tabs class="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] ${items.length ? "" : "border-b border-ui-border"}" aria-label="Canvas tabs">${tabs}</nav>
    ${history}<div class="flex items-center gap-0.5 border-b border-l border-ui-border px-1.5">${active ? reload : ""}${close}</div>
  </header>
  <div data-canvas-body data-canvas-item="${active?.id ?? ""}" data-canvas-kind="${esc(active?.kind ?? "")}" data-canvas-body-rev="${rev.body}"${active && kinds[active.kind]?.liveState ? ` data-canvas-state="${esc(JSON.stringify(active.state))}"` : ""} class="${active ? "" : "dot-grid-surface "}min-h-0 flex-1 overflow-auto">${body}</div>
</section>
<div class="canvas-resizer" data-canvas-resizer role="separator" aria-orientation="vertical" aria-label="Resize chat" tabindex="0"></div>`;
}
