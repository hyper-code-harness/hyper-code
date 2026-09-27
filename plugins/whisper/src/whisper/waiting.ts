/**
 * Lists top-level agents that need attention: unread replies first, then agents that are currently working.
 * Read-only. Use for the voice command "who is waiting / кто ждёт / непрочитанные" to decide where to switch.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Maximum number of agents returned. @default 8 @minimum 1 @maximum 50 */
    limit?: number;
}): Promise<{ agents: { id: string; title: string; unread: number; runState: string; updatedAt: number }[] }> {
    const list: any = await ctx.fns.session.list({});
    const agents = (Array.isArray(list) ? list : [])
        .filter((s: any) => !s.archivedAt && !s.parentId && s.visibility !== "hidden" && (Number(s.unread) > 0 || s.runState === "running"))
        .map((s: any) => ({ id: String(s.id), title: String(s.title || s.id), unread: Number(s.unread) || 0, runState: String(s.runState || "idle"), updatedAt: Number(s.updatedAt) || 0 }))
        .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.min(50, opts.limit ?? 8)));
    return { agents };
}
