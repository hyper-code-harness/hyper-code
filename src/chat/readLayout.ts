/**
 * Reads the chat.layout setting (instance scope: settings file, database, default) as a clean layout.
 *
 * Malformed values count as empty, so a bad setting can never take the chat down.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<types.chat.Layout> {
    let v: any = await ctx.fns.settings.get({ module: "chat", scopeType: "global", key: "layout" }).catch(() => null);
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const ids = (x: unknown) => Array.isArray(x) ? [...new Set(x.map(String).filter(Boolean))] : undefined;
    return { badges: ids(v.badges), buttons: ids(v.buttons), cards: ids(v.cards), hidden: ids(v.hidden) };
}
