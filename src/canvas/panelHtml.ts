/**
 * Renders the canvas work surface shown left of an agent's chat.
 *
 * The panel is always in the agent page; the page's data-canvas-open attribute shows or hides it, so
 * toggling never re-renders the chat (drafts, scroll and streaming stay put). For now the surface is
 * empty: a tab strip with nothing open and a close button.
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
        title: "Close canvas", ariaLabel: "Close canvas",
        class: "flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition hover:bg-base-200 hover:text-base-content",
        title: "Close canvas",
        attrs: { "data-canvas-toggle": "close" },
    });
    return `<section id="canvas-panel" data-canvas-panel data-agent-id="${id}" aria-label="Canvas" class="canvas-panel glass-panel my-2 ml-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ui-border">
  <header class="flex h-11 shrink-0 items-center gap-2 border-b border-ui-border px-3 text-xs">
    <i class="ph ph-square-half text-faint" aria-hidden="true"></i>
    <span class="font-semibold text-base-content">Canvas</span>
    <nav data-canvas-tabs class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Canvas tabs"></nav>
    ${close}
  </header>
  <div data-canvas-body class="dot-grid-surface flex min-h-0 flex-1 items-center justify-center overflow-auto">
    <div class="max-w-sm px-6 text-center text-faint">
      <i class="ph ph-square-half text-4xl" aria-hidden="true"></i>
      <p class="mt-2 text-sm font-medium text-muted">Canvas is empty</p>
      <p class="mt-1 text-xs">Files, images, documents and diagrams opened by you or the agent will appear here.</p>
    </div>
  </div>
</section>
<div class="canvas-resizer" data-canvas-resizer role="separator" aria-orientation="vertical" aria-label="Resize chat" tabindex="0"></div>`;
}
