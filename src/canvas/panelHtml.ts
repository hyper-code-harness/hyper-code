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
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    const items = await ctx.fns.canvas.list({ agentId: opts.agentId }).catch(() => [] as types.canvas.Item[]);
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    const active = items.find(i => i.active) ?? null;
    const rev = await ctx.fns.canvas.revision({ agentId: opts.agentId });
    const tabs = items.map(item => {
        const icon = kinds[item.kind]?.icon ?? "square";
        return `<div class="canvas-tab group flex h-7 max-w-56 shrink-0 items-center gap-1 rounded-full pl-2.5 pr-1 ${item.active ? "bg-base-100 text-base-content shadow-sm" : "text-muted hover:bg-base-200"}" data-canvas-tab="${item.id}"${item.active ? ' aria-current="true"' : ""}>
      <button type="button" class="flex min-w-0 items-center gap-1" data-canvas-select="${item.id}" title="${esc(item.title)}"><i class="ph ph-${esc(icon)} shrink-0" aria-hidden="true"></i><span class="truncate">${esc(item.title)}</span></button>
      <button type="button" class="flex size-5 shrink-0 items-center justify-center rounded-full text-faint opacity-60 hover:bg-base-300 hover:opacity-100" data-canvas-close-item="${item.id}" title="Close tab" aria-label="Close ${esc(item.title)}"><i class="ph ph-x text-3xs" aria-hidden="true"></i></button>
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
  <header class="flex h-11 shrink-0 items-center gap-2 border-b border-ui-border px-3 text-xs">
    <i class="ph ph-square-half text-faint" aria-hidden="true"></i>
    <span class="font-semibold text-base-content">Canvas</span>
    <nav data-canvas-tabs class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Canvas tabs">${tabs}</nav>
    ${close}
  </header>
  <div data-canvas-body data-canvas-item="${active?.id ?? ""}" data-canvas-body-rev="${rev.body}"${active && kinds[active.kind]?.liveState ? ` data-canvas-state="${esc(JSON.stringify(active.state))}"` : ""} class="${active ? "" : "dot-grid-surface "}min-h-0 flex-1 overflow-auto">${body}</div>
</section>
<div class="canvas-resizer" data-canvas-resizer role="separator" aria-orientation="vertical" aria-label="Resize chat" tabindex="0"></div>`;
}
