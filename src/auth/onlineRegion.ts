/**
 * Wraps the "who is online" avatars in a live region that re-fetches on presence changes.
 *
 * One place builds the region for both spots: the left quick bar (everyone in this Hyper, column) and
 * the agent inspector header (people in this chat, row). Initial HTML may be empty; it loads on sight.
 * @param opts.agentId Only people looking at this chat; omit for everyone in this Hyper.
 * @param opts.layout "row" or "column". @default "row"
 * @param opts.html Already rendered avatars; omit to load on first display.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Only people looking at this chat; omit for everyone in this Hyper. */
    agentId?: string;
    /** "row" or "column". @default "row" */
    layout?: "row" | "column";
    /** Already rendered avatars; omit to load on first display. */
    html?: string;
}): string {
    const column = opts.layout === "column";
    const params = new URLSearchParams();
    if (opts.agentId) params.set("agent", opts.agentId);
    if (column) params.set("layout", "column");
    const id = opts.agentId ? `online-chat-${opts.agentId.replace(/[^A-Za-z0-9_-]/g, "-")}` : "online-all";
    return ctx.fns.ui.live({
        id, url: "/auth/online" + (params.size ? "?" + params : ""), topic: "presence", every: 60,
        html: opts.html ?? "", trigger: opts.html === undefined ? "load" : undefined,
        attrs: column ? 'class="mb-2 flex w-full flex-col items-center"' : 'data-agent-meta-label class="flex shrink-0 items-center"',
    });
}
