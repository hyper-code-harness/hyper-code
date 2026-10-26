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
    const w = ctx.fns.w;
    const id = w.escape({ text: opts.agentId });
    const esc = (text: string) => w.escape({ text });
    const items = await ctx.fns.canvas.list({ agentId: opts.agentId }).catch(() => [] as types.canvas.Item[]);
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    const iconOf = (item: types.canvas.Item) => kinds[item.kind]?.icon ?? "square";
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
    const openUrl = `/canvas/${encodeURIComponent(opts.agentId)}`;
    const rev = await ctx.fns.canvas.revision({ agentId: opts.agentId });

    // Tabs: macOS Finder-style equal segments (w.tabs). canvas.js selects and closes them by these hooks.
    const tabs = w.tabs({
        active: active ? String(active.id) : undefined,
        items: items.map(item => ({
            id: String(item.id),
            label: item.title,
            icon: iconOf(item),
            title: `${item.title} · opened ${stamp(item.createdAt)}`,
            action: { action: "select-canvas-tab" },
            attrs: { "data-canvas-tab": item.id },
            close: { action: "close-canvas-tab" },
            closeAttrs: { "data-canvas-close-item": item.id },
        })),
    });

    // Recently closed: closing only marks a tab, so it can come back with its state (kept 30 days).
    const historyId = `canvas-history-${String(opts.agentId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const history = closed.length ? w.popover({
        id: historyId,
        label: "Recently closed tabs",
        placement: "below-end",
        width: 288,
        trigger: w.iconButton({ icon: "clock-counter-clockwise", label: "Recently closed tabs", action: { popover: historyId }, size: 28 }),
        body: w.listSection({ title: "Recently closed", rows: closed.map(item => w.listRow({
            label: item.title,
            icon: iconOf(item),
            hint: ago(item.closedAt ?? now),
            action: { action: "reopen-canvas-tab" },
            attrs: { "data-canvas-reopen": item.id, "aria-label": `${item.title} — opened ${stamp(item.createdAt)}, closed ${stamp(item.closedAt ?? now)}` },
        })).join("") }),
    }) : "";

    // Canvas controls live with the canvas: fold the chat into a strip over it (canvas on the whole page), reload, close.
    const foldChat = w.iconButton({ icon: "arrows-out-simple", label: "Canvas on the whole page — ⌘\\", size: 28, marks: { action: "fold-chat" },
        action: { post: openUrl, vals: { op: "toggleChat" } }, attrs: { "data-canvas-chat-toggle": true, "hx-disabled-elt": "this" } });
    const reload = active ? w.iconButton({ icon: "arrow-clockwise", label: "Reload tab", size: 28, marks: { action: "reload-canvas-tab" }, attrs: { "data-canvas-reload": true } }) : "";
    const close = w.iconButton({ icon: "x", label: "Close canvas", size: 28, marks: { action: "close-canvas" }, attrs: { "data-canvas-toggle": "close" } });
    const header = w.paneHeader({ center: tabs, actions: history + foldChat + reload + close, attrs: { "data-canvas-header": true } });

    let body: string;
    if (!active) {
        body = w.empty({ icon: "square-half", title: "Canvas is empty", hint: "Files, images, documents and diagrams opened by you or the agent will appear here." });
    } else {
        const kind = kinds[active.kind];
        try {
            if (!kind) throw new Error(`canvas kind "${active.kind}" is not loaded`);
            body = await kind.render(ctx, { agentId: opts.agentId, item: active });
        } catch (error: any) {
            body = w.empty({ icon: "warning", title: "This tab could not be drawn", hint: String(error?.message ?? error), tone: "danger" });
        }
    }

    // The canvas folded into a bar (shown only while the canvas is closed, ui.layout CSS): a header cell that opens
    // it, then one icon per tab that opens it on that tab. Plain htmx posts; every page follows canvas.changed.
    const rail = w.rail({
        label: "Canvas (closed)",
        attrs: { "data-canvas-rail": true },
        head: w.railItem({ label: "Open canvas — ⌘\\", icon: "square-half", action: { post: openUrl, vals: { open: true } } }),
        items: items.map(item => w.railItem({ label: `Open ${item.title}`, icon: iconOf(item), current: item.active, action: { post: openUrl, vals: { open: true, activeItemId: item.id } } })).join(""),
    });

    const state = active && kinds[active.kind]?.liveState ? ` data-canvas-state="${esc(JSON.stringify(active.state))}"` : "";
    return `<section id="canvas-panel" data-canvas-panel data-agent-id="${id}" data-canvas-rev="${rev.panel}" aria-label="Canvas" class="canvas-panel">
  ${rail}
  ${header}
  <div data-canvas-body data-canvas-item="${active?.id ?? ""}" data-canvas-kind="${esc(active?.kind ?? "")}" data-canvas-body-rev="${rev.body}"${state}${active ? "" : " data-empty"}>${body}</div>
</section>
<div class="canvas-resizer" data-canvas-resizer role="separator" aria-orientation="vertical" aria-label="Resize chat" tabindex="0"></div>`;
}
