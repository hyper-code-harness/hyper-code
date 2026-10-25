// Chat header button: opens the agent's inspector — settings, automation, goal, knowledge, team, plan — as a canvas
// tab (agent.inspector, a live @view page). A plain htmx post; the canvas follows canvas.changed.
export default {
    order: 12,
    render: (ctx: Context, _session: Session | null, view: types.chat.RenderContext) => ctx.fns.w.pressable({ html: '<i class="ph ph-info" aria-hidden="true"></i>', label: "Agent inspector", title: "Agent inspector — settings, automation, plan, team", action: { post: `/canvas/${encodeURIComponent(view.agent.id)}`, target: "this", swap: "none", vals: { op: "showInspector" } }, marks: { action: "open-agent-inspector" }, attrs: { "hx-disabled-elt": "this" }, class: "flex size-7 items-center justify-center rounded-full text-subtle hover:bg-base-200 hover:text-base-content" }),
} satisfies types.chat.Button;
