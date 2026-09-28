// Someone opened a stream. Returns the leave fn, so the route cannot forget to
// call it — the connection and the presence have exactly the same lifetime.
//
// Without a session (AUTH=off) everyone is the same anonymous person, which is
// the truth: the workspace has no way to tell them apart and pretending
// otherwise would put ghosts in the bar.
/**
 * Registers an open event stream as presence and returns the function that ends it.
 *
 * Presence is per person (refcounted tabs) and per chat: stream topics `agent:<id>` say which chats
 * the tab is looking at. Every join/leave publishes topic "presence" so live avatar rows re-fetch.
 * @param opts.topics Topics of the stream; `agent:<id>` entries mark the chats this tab shows.
 */
export default function (ctx: Context, session: Session | null, opts?: {
    /** Topics of the stream; `agent:<id>` entries mark the chats this tab shows. */
    topics?: string[];
}): () => void {
    const user = (session as any)?.user;
    // session.user is the auth module's User ({ id, name }); older callers put JWT claims ({ sub }) there.
    const id = user?.id ?? user?.sub ?? "local";
    const name = user?.name ?? "you";
    const agents = [...new Set((opts?.topics ?? []).map((t) => /^agent:(.+)$/.exec(t)?.[1]).filter((a): a is string => !!a))];

    const presence = ((ctx.state.procs.events ??= {}).presence ??= new Map());
    let p = presence.get(id);
    if (p) p.tabs += 1;
    else presence.set(id, p = { id, name, tabs: 1, agents: new Map() });
    for (const a of agents) p.agents.set(a, (p.agents.get(a) ?? 0) + 1);
    ctx.fns.procs.events.emit({ event: { type: "presence" } });
    ctx.fns.procs.events.refresh({ topic: "presence", reason: "join" });

    let left = false;
    return () => {
        if (left) return;                       // abort can fire more than once
        left = true;
        const q = presence.get(id);
        if (!q) return;
        q.tabs -= 1;
        for (const a of agents) { const n = (q.agents.get(a) ?? 1) - 1; if (n <= 0) q.agents.delete(a); else q.agents.set(a, n); }
        if (q.tabs <= 0) presence.delete(id);
        ctx.fns.procs.events.emit({ event: { type: "presence" } });
        ctx.fns.procs.events.refresh({ topic: "presence", reason: "leave" });
    };
}
