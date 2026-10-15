// Panel card: the chat's family — parent, delegated children, and Fork.
export default {
    title: "Team",
    icon: "ph-users-three",
    order: 40,
    async render(ctx: Context, _session: Session | null, view: types.chat.RenderContext): Promise<types.chat.CardRow[]> {
        const a = view.agent;
        const team = await Promise.resolve(ctx.fns.agent.team({ agent: a })).catch(() => [] as any[]);
        const running = team.filter((m: any) => m.runState && m.runState !== "idle").length;
        const rows: types.chat.CardRow[] = [];
        if (a.parentId) rows.push({ icon: "ph-arrow-bend-up-left", label: String(view.parent?.title || a.parentId), hint: "parent", href: `/agent/${encodeURIComponent(String(a.parentId))}` });
        for (const m of team.slice(0, 4)) rows.push({ icon: m.runState && m.runState !== "idle" ? "ph-circle-notch" : "ph-user", label: String(m.title || m.id), hint: m.status, href: `/agent/${encodeURIComponent(m.id)}` });
        if (team.length > 4) rows.push({ icon: "ph-dots-three", label: `${team.length - 4} more`, hint: running ? `${running} running` : undefined });
        rows.push({ icon: "ph-git-fork", label: "Fork and open", post: `/agent/${encodeURIComponent(a.id)}/fork` });
        return rows;
    },
} satisfies types.chat.Card;
