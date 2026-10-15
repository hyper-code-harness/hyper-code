/**
 * Reads the Dock layout that applies to the current viewer.
 *
 * The person's own layout (setting dock.layout, scope user) replaces the instance layout (scope global,
 * env HYPER_DOCK) as a whole; with neither, the layout is empty and entries keep their own zone and order.
 * Malformed JSON is treated as empty so a bad value can never take the page shell down.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<{ layout: types.dock.Layout; source: "user" | "instance" | "default"; userId: string | null }> {
    const userId = await ctx.fns.auth.viewerId({}).catch(() => null);
    const parse = (raw: unknown): types.dock.Layout | null => {
        if (raw == null || raw === "") return null;
        let v: any = raw;
        if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
        if (!v || typeof v !== "object" || Array.isArray(v)) return null;
        const ids = (x: unknown) => Array.isArray(x) ? [...new Set(x.map(String).filter(Boolean))] : undefined;
        return { top: ids(v.top), bottom: ids(v.bottom), hidden: ids(v.hidden), pins: ids(v.pins)?.filter(href => href.startsWith("/") && !href.startsWith("//")) };
    };
    if (userId) {
        const mine = parse(await ctx.fns.settings.get({ module: "dock", scopeType: "user", scopeId: userId, key: "layout" }));
        if (mine) return { layout: mine, source: "user", userId };
    }
    const shared = parse(await ctx.fns.settings.get({ module: "dock", scopeType: "global", key: "layout" }));
    return { layout: shared ?? {}, source: shared ? "instance" : "default", userId };
}
