/**
 * Records that stored messages or events of an agent were edited or removed in place, from a given idx.
 *
 * Call it after any write that changes or deletes existing rows of the messages or events table (not after an append). session.syncAgentState reads only rows above the last one it holds, so an in-place edit is picked up only when it is recorded here: the next sync of every live copy of that agent reloads the table from the recorded idx. Pass 0 to reload the whole table. Kept in the memory of this process only.
 * @param opts.id Agent identifier.
 * @param opts.messages Smallest message idx that was edited or removed; omit when messages were not touched.
 * @param opts.events Smallest event idx that was edited or removed; omit when events were not touched.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** Smallest message idx that was edited or removed; omit when messages were not touched. */
        messages?: number;
        /** Smallest event idx that was edited or removed; omit when events were not touched. */
        events?: number;
    },
): Promise<{ rev: number }> {
    const state = (ctx.state.session ??= {});
    const rev = state.rev = (state.rev ?? 0) + 1;
    const edits = (state.edits ??= new Map());
    const entry = edits.get(opts.id) ?? { floor: 0, log: [] };
    for (const table of ["messages", "events"] as const) {
        const from = opts[table];
        if (from != null) entry.log.push({ rev, table, from: Math.max(0, Math.floor(Number(from)) || 0) });
    }
    // Capped: a sync that is older than a dropped entry cannot know what it missed and reloads in full.
    while (entry.log.length > 64) entry.floor = entry.log.shift()!.rev;
    edits.set(opts.id, entry);
    return { rev };
}
