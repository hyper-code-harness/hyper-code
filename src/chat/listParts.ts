/**
 * Lists the chat header parts of one kind in display order.
 *
 * Applies the chat.layout setting over each part's own order: ids listed for the kind come first in the
 * listed order, the rest follow by order then id, hidden ids are dropped. The core danger card (Archive,
 * Delete) is never hidden and always last. Use to inspect or test what the header and ⋯ panel will show.
 * @param opts.kind Which parts to list.
 * @param opts.layout Layout to apply instead of the chat.layout setting (tests, previews).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Which parts to list. */
        kind: "badge" | "button" | "card";
        /** Layout to apply instead of the chat.layout setting (tests, previews). */
        layout?: types.chat.Layout;
    },
): Promise<types.chat.RegisteredPart[]> {
    const layout = opts.layout ?? await ctx.fns.chat.readLayout({});
    const all = Object.values(((ctx.state as any).chat?.parts ?? {}) as Record<string, types.chat.RegisteredPart>).filter(p => p.kind === opts.kind);
    const pinned = (p: types.chat.RegisteredPart) => p.kind === "card" && p.id === "danger";
    const hidden = new Set(layout.hidden ?? []);
    const listed = (opts.kind === "badge" ? layout.badges : opts.kind === "button" ? layout.buttons : layout.cards) ?? [];
    const byId = new Map(all.map(p => [p.id, p]));
    const out: types.chat.RegisteredPart[] = [];
    const seen = new Set<string>();
    for (const id of listed) {
        const p = byId.get(id);
        if (!p || seen.has(id) || pinned(p) || hidden.has(id)) continue;
        out.push(p); seen.add(id);
    }
    const rest = all.filter(p => !seen.has(p.id) && !pinned(p) && !hidden.has(p.id))
        .sort((a, b) => Number(a.order ?? 100) - Number(b.order ?? 100) || a.id.localeCompare(b.id));
    return [...out, ...rest, ...all.filter(pinned)];
}
