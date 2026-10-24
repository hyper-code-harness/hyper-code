/**
 * Lists the global-menu widgets placed in the Dock side panel for the current person.
 *
 * Resolves the side panel's widget list: the person's own list (dock.panel setting, scope user), else the instance list (scope global), else the default — Recent by project with 20 chats. Placements of widgets that are not loaded are dropped. Use to draw or edit the panel.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ widgets: types.nav.Placement[]; source: "user" | "instance" | "default" }> {
    const loaded = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, unknown>;
        const parse = (raw: unknown): types.nav.Placement[] | null => {
            if (raw == null || raw === "") return null;
            let v: any = raw;
            if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
            if (!v || !Array.isArray(v.widgets)) return null;
            const seen = new Set<string>();
            return v.widgets.filter((p: any) => p && typeof p.widget === "string" && loaded[p.widget]).map((p: any, i: number) => {
                let id = String(p.id || p.widget);
                while (seen.has(id)) id = id + "-" + i;
                seen.add(id);
                return { id, widget: String(p.widget), ...(p.config && typeof p.config === "object" ? { config: p.config } : {}) };
            });
        };
        const userId = await ctx.fns.auth.viewerId({}).catch(() => null);
        if (userId) {
            const mine = parse(await ctx.fns.settings.get({ module: "dock", scopeType: "user", scopeId: userId, key: "panel" }));
            if (mine) return { widgets: mine, source: "user" };
        }
        const shared = parse(await ctx.fns.settings.get({ module: "dock", scopeType: "global", key: "panel" }));
        if (shared) return { widgets: shared, source: "instance" };
        return { widgets: loaded.recent ? [{ id: "recent", widget: "recent", config: { limit: 20 } }] : [], source: "default" };
}
