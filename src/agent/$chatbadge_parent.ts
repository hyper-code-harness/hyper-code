// Chat header badge on forks and delegated children: the parent chat, one click away.
export default {
    order: 20,
    render(_ctx: Context, _session: Session | null, view: types.chat.RenderContext): types.chat.Item | null {
        const parentId = view.agent.parentId;
        if (!parentId) return null;
        const name = String(view.parent?.title || parentId);
        return {
            icon: "ph-arrow-bend-up-left",
            label: name.slice(0, 24),
            title: `Forked from ${name} · inherited ${view.inheritedCount} msgs`,
            href: `/agent/${encodeURIComponent(String(parentId))}`,
            tone: "warning",
        };
    },
} satisfies types.chat.Badge;
