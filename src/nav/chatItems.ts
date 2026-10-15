/**
 * Turns agent cards from nav.agents into menu rows (types.nav.Item): model logo spinning while the chat
 * runs, unread dot, the owner's name when another person created it on a multi-user instance, and a 📌
 * toggle for the viewer's chat pin.
 * @param opts.agents Agent cards from nav.agents.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent cards from nav.agents. */
        agents: Array<{ id: string; title?: string | null; model?: string; icon?: string | null; runState?: string; hasUnread?: boolean; createdBy?: string | null }>;
    },
): Promise<types.nav.Item[]> {
    const users = opts.agents.some(a => a.createdBy) ? await ctx.fns.auth.listUsers({}).catch(() => [] as types.auth.User[]) : [];
    const me = (session as any)?.user?.id as string | undefined;
    const multi = users.length > 1 && !!me;
    const names = new Map(users.map((u: any) => [String(u.id), String(u.name ?? u.id)]));
    return opts.agents.map(agent => ({
        id: `agent:${agent.id}`,
        label: String(agent.title || agent.id),
        href: `/agent/${encodeURIComponent(agent.id)}`,
        model: String(agent.model ?? "?"),
        ...(agent.icon ? { avatar: agent.icon } : {}),
        active: !!agent.runState && agent.runState !== "idle",
        unread: !!agent.hasUnread,
        ...(multi && agent.createdBy && agent.createdBy !== me ? { owner: names.get(agent.createdBy) ?? agent.createdBy } : {}),
        pin: `agent:${agent.id}`,
    }));
}
