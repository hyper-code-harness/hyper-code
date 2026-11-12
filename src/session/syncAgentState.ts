type Seen = Partial<Record<"messages" | "events", { rows: any[]; len: number; rev: number }>>;

/**
 * Bring a live agent's messages and events up to date with the database.
 *
 * Reads only what changed since this object's last sync: the rows appended after the last one it
 * holds and, when session.markChanged recorded an in-place edit or removal, everything from the
 * edited idx. It reads the whole table on the first sync, when the array was replaced or pushed to
 * from outside, and for a fork that inherits part of its parent's transcript.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Live agent instance to operate on. */
agent: types.agent.Agent }): Promise<types.agent.Agent> {
    const { agent } = opts;
    const synced = ((ctx.state.session ??= {}).synced ??= new WeakMap());
    const seen: Seen = synced.get(agent) ?? {};
    synced.set(agent, seen);
    // A fork with an inherited prefix holds rows of several agents, each with its own idx numbering:
    // there is no single "last idx" to continue from. A fork cut at 0 inherits nothing and is read like a root.
    if (agent.parentId && agent.forkOffset !== 0) {
        delete seen.messages;
        agent.messages = await ctx.fns.session.getFullMessages({ id: agent.id });
    } else {
        agent.messages = await refresh(ctx, agent, seen, "messages", (fromIdx) => ctx.fns.session.getMessages({ id: agent.id, fromIdx }));
    }
    agent.events = await refresh(ctx, agent, seen, "events", (fromIdx) => ctx.fns.session.getEvents({ id: agent.id, fromIdx }));
    return agent;
}

async function refresh(ctx: Context, agent: types.agent.Agent, seen: Seen, table: "messages" | "events", read: (fromIdx: number) => Promise<any[]>): Promise<any[]> {
    const state = ctx.state.session ?? {};
    // Taken BEFORE the rows are read: an edit that lands during the read gets a higher rev and is replayed by the next sync.
    const rev = state.rev ?? 0;
    const prev = seen[table];
    const rows: any[] = agent[table] ?? [];
    let start = 0;
    if (prev && rows === prev.rows && rows.length === prev.len) {
        const edits = state.edits?.get(agent.id);
        if (!edits || edits.floor <= prev.rev) {
            start = rows.length ? Number(rows[rows.length - 1]?.idx) + 1 : 0;
            for (const edit of edits?.log ?? []) if (edit.table === table && edit.rev > prev.rev) start = Math.min(start, edit.from);
            if (!Number.isInteger(start) || start < 0) start = 0;
        }
    }
    const fresh = await read(start);
    let next = fresh;
    // A reader that ignored fromIdx (a test double) returned the whole table: take it as it is.
    if (start > 0 && fresh.every((row: any) => Number.isInteger(row?.idx) && row.idx >= start)) {
        let keep = rows.length;
        while (keep > 0 && rows[keep - 1].idx >= start) keep--;
        // Always a new array when something changed: whoever still holds the old one keeps a consistent snapshot.
        next = keep === rows.length && !fresh.length ? rows : [...rows.slice(0, keep), ...fresh];
    }
    seen[table] = { rows: next, len: next.length, rev };
    return next;
}
