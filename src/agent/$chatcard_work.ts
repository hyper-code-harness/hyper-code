// Panel card: what the chat is working on — its plan progress and goal (a click opens the task list or the goal editor).
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
            // The plan row opens the to-do list (agent.planPopup), like the plan count in the message box.
            rows.push({ icon: "ph-list-checks", label: String(plan.title || "Plan"), hint: `${done}/${tasks.length}`, popup: { method: "agent.planPopup", params: { agentId: view.agent.id } } });
            if (active) rows.push({ icon: "ph-arrow-right", label: String(active.title) });
        }
        const goalText = String(goal?.statement ?? goal?.text ?? "").trim();
        // The goal row opens its editor (agent.goalPopup), like the target icon in the message box.
        const edit = { method: "agent.goalPopup", params: { agentId: view.agent.id } };
        if (goalText) rows.push({ icon: "ph-target", label: goalText, hint: goal?.status ? String(goal.status) : undefined, popup: edit });
        if (!rows.length) rows.push({ icon: "ph-list-checks", label: "No plan yet" });
        if (!goalText) rows.push({ icon: "ph-target", label: "Set a goal…", popup: edit });
        return rows;
    },
} satisfies types.chat.Card;
