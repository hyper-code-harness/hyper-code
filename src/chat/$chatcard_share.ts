// Panel card: ways to share or open the chat elsewhere.
export default {
    title: "Share",
    icon: "ph-share-network",
    order: 60,
    render(_ctx: Context, _session: Session | null, view: types.chat.RenderContext): types.chat.CardRow[] {
        const id = encodeURIComponent(view.agent.id);
        return [
            { icon: "ph-users-three", label: "Shared Agents", href: `/shared-agents?from=${id}` },
            { icon: "ph-info", label: "Agent page", href: `/agent/${id}` },
        ];
    },
} satisfies types.chat.Card;
