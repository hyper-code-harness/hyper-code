// Who is here. A workspace can have several people in it — the chat is one
// conversation with one agent, so knowing who else is looking at it is the
// difference between talking to a room and talking to a wall.
//
// Presence is counted, not flagged: one person with three tabs is one person,
// and closing one tab does not make them leave. That refcount is the whole
// trick — it is what makes "who is here" survive a reload.
/**
 * Lists who has Hyper open now: person id, name, open tabs and the chats (agent ids) they are looking at.
 * @param opts.agentId Only people currently looking at this chat.
 */
export default function (ctx: Context, _session: Session | null, opts?: {
    /** Only people currently looking at this chat. */
    agentId?: string;
}): Array<{ id: string; name: string; tabs: number; agents: string[] }> {
    return [...(ctx.state.procs?.events?.presence ?? new Map()).values()]
        .filter(p => !opts?.agentId || p.agents?.has(opts.agentId))
        .map(p => ({ id: p.id, name: p.name, tabs: p.tabs, agents: [...(p.agents?.keys() ?? [])] }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
