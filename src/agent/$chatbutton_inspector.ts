// Chat header button: opens the agent's inspector — settings, automation, goal, knowledge, team, plan — as a canvas
// tab (agent.inspector, a live @view page). A plain htmx post; the canvas follows canvas.changed.
export default {
    order: 12,
    render: (ctx: Context, _session: Session | null, view: types.chat.RenderContext) => ctx.fns.procs.ui.button({
        action: "open-agent-inspector",
        html: '<i class="ph ph-info" aria-hidden="true"></i>',
        appearance: "plain",
        ariaLabel: "Agent inspector",
        title: "Agent inspector — settings, automation, plan, team",
        post: `/canvas/${encodeURIComponent(view.agent.id)}`,
        vals: { op: "showInspector" },
        target: "this",
        swap: "none",
        class: "flex size-7 items-center justify-center rounded-full text-subtle hover:bg-base-200 hover:text-base-content",
        attrs: { "hx-disabled-elt": "this" },
    }),
} satisfies types.chat.Button;
