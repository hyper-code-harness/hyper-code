// Tells the agent what its canvas shows. The block only changes when tabs, the active tab or a tab's state
// change, so agent.syncWorldState sends it once and again only then.
/** Answers agent.promptAugment with the open canvas tabs of the agent, the active one first, with its state.
 * @param opts.agentId Agent whose turn is being prepared.
 * @param opts.text Latest user message, verbatim.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn is being prepared. */
    agentId: string;
    /** Latest user message, verbatim. */
    text: string;
}): Promise<string> {
    const [view, items] = await Promise.all([ctx.fns.canvas.get({ agentId: opts.agentId }), ctx.fns.canvas.list({ agentId: opts.agentId })]);
    if (!items.length) return "";
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    const line = async (item: types.canvas.Item) => {
        const kind = kinds[item.kind];
        let what = `${item.kind} ${JSON.stringify(item.args)}`;
        if (kind?.describe) what = await Promise.resolve(kind.describe(ctx, { item })).catch(() => what);
        // A view tab's history (back/forward) and page version are the tab's own bookkeeping, not what is on screen.
        const shown = Object.fromEntries(Object.entries(item.state).filter(([k]) => !(item.kind === "view" && ["back", "forward", "page"].includes(k))));
        const state = Object.keys(shown).length ? ` — state ${JSON.stringify(shown).slice(0, 1000)}` : "";
        const live = typeof kind?.live === "function" ? kind.live(item) : kind?.live;
        const mark = live === true ? "live, " : live === false ? `snapshot from ${new Date(item.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC, ` : "";
        return `- [${item.id}] "${item.title}": ${mark}${what}${item.active ? " (active)" : ""}${state}`;
    };
    const ordered = [...items.filter(i => i.active), ...items.filter(i => !i.active)];
    return `## Canvas\n\nThe canvas beside the chat is ${view.open ? "open" : "closed"}; tabs:\n` + (await Promise.all(ordered.map(line))).join("\n");
}
