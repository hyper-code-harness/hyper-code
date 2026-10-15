// Panel card: what the chat is working on — its plan progress and goal.
export default {
    title: "Work",
    icon: "ph-list-checks",
    order: 30,
    render(_ctx: Context, _session: Session | null, view: types.chat.RenderContext): types.chat.CardRow[] | null {
        const plan: any = (view.agent.scratchpad as any)?.plan;
        const tasks: any[] = Array.isArray(plan?.tasks) ? plan.tasks : [];
        const goal: any = view.agent.goal;
        const rows: types.chat.CardRow[] = [];
        if (tasks.length) {
            const done = tasks.filter(t => t.status === "done").length;
            const active = tasks.find(t => t.status === "active") ?? tasks.find(t => t.status !== "done");
            rows.push({ icon: "ph-list-checks", label: String(plan.title || "Plan"), hint: `${done}/${tasks.length}` });
            if (active) rows.push({ icon: "ph-arrow-right", label: String(active.title) });
        }
        const goalText = String(goal?.statement ?? goal?.text ?? "").trim();
        if (goalText) rows.push({ icon: "ph-target", label: goalText, hint: goal?.status ? String(goal.status) : undefined });
        return rows.length ? rows : [{ icon: "ph-list-checks", label: "No plan yet" }];
    },
} satisfies types.chat.Card;
