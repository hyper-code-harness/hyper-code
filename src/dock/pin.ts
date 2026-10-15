/**
 * Pins or unpins a chat or a page in the current person's Dock.
 *
 * A chat (`agent`) uses the person's existing pin (auth.setPinned), so it shows the same in the global menu
 * and the mobile app. A page (`page`, a local href such as `/news`) is added to or removed from layout.pins of
 * the person's own Dock layout. Unpinning also drops the entry from the layout's order lists.
 * @param opts.kind What is pinned: a chat or a page.
 * @param opts.target Chat id for kind agent; local href starting with / for kind page.
 * @param opts.pinned True to pin, false to unpin. @default true
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** What is pinned: a chat or a page. */
        kind: "agent" | "page";
        /** Chat id for kind agent; local href starting with / for kind page. */
        target: string;
        /** True to pin, false to unpin. @default true */
        pinned?: boolean;
    },
): Promise<{ id: string; pinned: boolean }> {
    const pinned = opts.pinned !== false;
    const target = String(opts.target ?? "").trim();
    if (opts.kind === "agent") {
        if (!/^[A-Za-z0-9_-]+$/.test(target)) throw new Error("dock.pin: invalid agent id");
        await ctx.fns.auth.setPinned({ agentId: target, pinned });
    } else if (opts.kind === "page") {
        if (!target.startsWith("/") || target.startsWith("//")) throw new Error("dock.pin: page must be a local href such as /news");
    } else throw new Error("dock.pin: kind must be agent or page");
    const id = `${opts.kind}:${target}`;
    const { layout } = await ctx.fns.dock.effectiveLayout({});
    const drop = (list?: string[]) => (list ?? []).filter(x => x !== id);
    const pins = opts.kind === "page" ? (pinned ? [...new Set([...(layout.pins ?? []), target])] : (layout.pins ?? []).filter(x => x !== target)) : layout.pins;
    if (opts.kind === "page" || !pinned) {
        await ctx.fns.dock.saveLayout({ layout: { top: pinned ? layout.top : drop(layout.top), bottom: pinned ? layout.bottom : drop(layout.bottom), hidden: drop(layout.hidden), pins } });
    }
    ctx.fns.procs.events.emit({ event: { type: "dock.changed" } });
    return { id, pinned };
}
