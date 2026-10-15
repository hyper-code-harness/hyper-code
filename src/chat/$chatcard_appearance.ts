// Panel card: chat appearance — icon, name and model. Reasoning effort lives in the composer.
export default {
    title: "Appearance",
    icon: "ph-palette",
    order: 10,
    render(_ctx: Context, _session: Session | null, view: types.chat.RenderContext): types.chat.CardRow[] {
        const a = view.agent;
        const agentId = a.id;
        return [
            { icon: "ph-smiley", label: a.icon ? "Change icon…" : "Set icon…", popup: { method: "chat.iconPopup", params: { agentId } } },
            { icon: "ph-pencil-simple", label: "Rename…", popup: { method: "chat.renamePopup", params: { agentId } } },
            { icon: "ph-cpu", label: "Model", hint: String(a.model).split(":").pop(), popup: { method: "agent.modelPicker", params: { agentId } } },
        ];
    },
} satisfies types.chat.Card;
