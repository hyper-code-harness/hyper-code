// Panel card: Archive and Delete. Owned by the core: always last, cannot be hidden by chat.layout.
export default {
    title: "Danger zone",
    icon: "ph-warning",
    order: 1000,
    render(_ctx: Context, _session: Session | null, view: types.chat.RenderContext): types.chat.CardRow[] {
        const id = encodeURIComponent(view.agent.id);
        return [
            { icon: "ph-archive", label: "Archive", hint: "keeps transcript", post: `/agent/${id}/archive` },
            { icon: "ph-trash", label: "Delete", post: `/agent/${id}/delete`, confirm: `Delete ${view.agent.id}? The transcript goes with it.`, tone: "danger" },
        ];
    },
} satisfies types.chat.Card;
