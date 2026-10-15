/**
 * Reads the global menu (⌘/) layout that applies to the current viewer.
 *
 * The person's own layout (setting nav.layout, scope user) replaces the instance layout (scope global,
 * env HYPER_NAV) as a whole; with neither, the layout is empty and only the built-in home tab shows.
 * Malformed JSON is treated as empty so a bad value can never break the menu.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<{ layout: types.nav.Layout; source: "user" | "instance" | "default"; userId: string | null }> {
    const userId = await ctx.fns.auth.viewerId({}).catch(() => null);
    const parse = (raw: unknown): types.nav.Layout | null => {
        if (raw == null || raw === "") return null;
        let v: any = raw;
        if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
        if (!v || typeof v !== "object" || Array.isArray(v)) return null;
        const ids = (x: unknown) => Array.isArray(x) ? [...new Set(x.map(String).filter(Boolean))] : undefined;
        const tabs = Array.isArray(v.tabs) ? v.tabs.filter((t: any) => t && typeof t === "object" && typeof t.id === "string" && t.id) : undefined;
        return { version: Number(v.version) || 1, tabs, hidden: ids(v.hidden), widgetsHidden: ids(v.widgetsHidden), searchHidden: ids(v.searchHidden) };
    };
    if (userId) {
        const mine = parse(await ctx.fns.settings.get({ module: "nav", scopeType: "user", scopeId: userId, key: "layout" }));
        if (mine) return { layout: mine, source: "user", userId };
    }
    const shared = parse(await ctx.fns.settings.get({ module: "nav", scopeType: "global", key: "layout" }));
    return { layout: shared ?? {}, source: shared ? "instance" : "default", userId };
}
