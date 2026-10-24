/**
 * Changes the current person's Dock side panel widgets: add, remove, move, configure or reset.
 *
 * Applies one edit to the side panel beside the Dock and saves the result as the person's own list (dock.panel, scope user; the instance list without a signed-in person). Starts from what the person sees now (dock.panelWidgets), so the first edit copies the default. reset deletes the person's list so the default (Recent by project) applies again.
 * @param opts.op What to change.
 * @param opts.id Placement id (remove, move, config).
 * @param opts.widget Widget id to add, a $widget_ id such as recent or inbox.unread (add).
 * @param opts.dir Direction for move: -1 up, 1 down. @default 1
 * @param opts.config Settings merged into the placement's config (config).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** What to change. */
        op: "add" | "remove" | "move" | "config" | "reset";
        /** Placement id (remove, move, config). */
        id?: string;
        /** Widget id to add, a $widget_ id such as recent or inbox.unread (add). */
        widget?: string;
        /** Direction for move: -1 up, 1 down. @default 1 */
        dir?: -1 | 1;
        /** Settings merged into the placement's config (config). */
        config?: Record<string, unknown>;
    },
): Promise<{ ok: boolean; widgets: types.nav.Placement[]; error?: string }> {
    const userId = await ctx.fns.auth.viewerId({}).catch(() => null);
        const scope = userId ? { scopeType: "user", scopeId: userId } : { scopeType: "global", scopeId: "" };
        if (opts.op === "reset") {
            await ctx.fns.settings.remove({ module: "dock", key: "panel", ...scope });
                return { ok: true, widgets: (await ctx.fns.dock.panelWidgets({})).widgets };
        }
        const widgets = [...(await ctx.fns.dock.panelWidgets({})).widgets];
        const at = widgets.findIndex(p => p.id === opts.id);
        if (opts.op === "add") {
            const known = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, unknown>;
            if (!opts.widget || !known[opts.widget]) return { ok: false, widgets, error: "unknown widget" };
            let id = opts.widget, n = 2;
            while (widgets.some(p => p.id === id)) id = opts.widget + "-" + n++;
            widgets.push({ id, widget: opts.widget });
        } else {
            if (at < 0) return { ok: false, widgets, error: "unknown placement" };
            if (opts.op === "remove") widgets.splice(at, 1);
            else if (opts.op === "move") {
                const to = at + (opts.dir === -1 ? -1 : 1);
                if (to >= 0 && to < widgets.length) { const [p] = widgets.splice(at, 1); widgets.splice(to, 0, p!); }
            } else if (opts.op === "config") widgets[at] = { ...widgets[at]!, config: { ...(widgets[at]!.config ?? {}), ...(opts.config ?? {}) } };
        }
        await ctx.fns.settings.set({ module: "dock", key: "panel", ...scope, value: JSON.stringify({ widgets }) });
        return { ok: true, widgets };
}
