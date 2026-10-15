/**
 * Lists the Dock entries of the current viewer in display order, split into the top and bottom zones.
 *
 * Applies the effective layout (dock.layout) over each `$dock_` entry's default zone and order: ids listed
 * in layout.top / layout.bottom come first in that zone in the listed order, the rest follow by order then
 * id, and layout.hidden entries are returned separately. Pinned chats and pages (dock.pinned) take part as
 * `agent:<id>` / `page:<href>` entries. The fixed global menu and person entries are not
 * part of this list. Use to inspect or test what the Dock will show.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<{ top: types.dock.Registered[]; bottom: types.dock.Registered[]; hidden: types.dock.Registered[]; source: "user" | "instance" | "default" }> {
    const { layout, source } = await ctx.fns.dock.effectiveLayout({});
    const registry = { ...((ctx.state as any).dock?.items ?? {}) } as Record<string, types.dock.Registered>;
    for (const pin of await ctx.fns.dock.pinned({ pages: layout.pins ?? [] })) registry[pin.id] = pin;
    const hiddenIds = new Set(layout.hidden ?? []);
    const all = Object.values(registry);
    const byDefault = (a: types.dock.Registered, b: types.dock.Registered) => Number(a.order ?? 100) - Number(b.order ?? 100) || a.id.localeCompare(b.id);
    const placed = new Set<string>();
    const zone = (name: "top" | "bottom") => {
        const listed = (layout[name] ?? []).map(id => registry[id]).filter((x): x is types.dock.Registered => !!x && !hiddenIds.has(x.id) && !placed.has(x.id));
        listed.forEach(x => placed.add(x.id));
        return listed;
    };
    const top = zone("top");
    const bottom = zone("bottom");
    for (const item of all.filter(x => !placed.has(x.id) && !hiddenIds.has(x.id)).sort(byDefault)) {
        (item.zone === "bottom" ? bottom : top).push(item);
        placed.add(item.id);
    }
    return { top, bottom, hidden: all.filter(x => hiddenIds.has(x.id)).sort(byDefault), source };
}
