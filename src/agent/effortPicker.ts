/**
 * Renders the reasoning effort picker opened from the chat composer
 *
 * Render a compact polished popup listing only the effort levels supported by the agent current model, with descriptions and requested/applied state. Each action posts to the selected agent effort route.
 * @param opts.agentId Agent whose effort can be changed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose effort can be changed. */
        agentId: string;
    },
): Promise<Response> {
    const id = String(opts.agentId ?? "").trim();
    const target = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!target) return new Response("agent not found", { status: 404 });
    const requested = (target.reasoningEffort ?? "auto") as types.llm.ReasoningEffort;
    const caps = await ctx.fns.llm.reasoningCapabilities({ model: target.model });
    const resolved = await ctx.fns.llm.resolveReasoningEffort({ model: target.model, effort: requested });
    const esc = (x:any) => ctx.fns.w.escape({ text: String(x ?? "") });
    const copy: Record<string, { label: string; detail: string; icon: string }> = {
     auto:{label:"Auto",detail:`Model recommendation · ${resolved.applied}`,icon:"ph-magic-wand"},
     off:{label:"Off",detail:"Fastest; no deliberate reasoning",icon:"ph-lightning"},
     minimal:{label:"Minimal",detail:"Very quick checks",icon:"ph-gauge"},
     low:{label:"Low",detail:"Fast and quota-conscious",icon:"ph-leaf"},
     medium:{label:"Medium",detail:"Balanced for most work",icon:"ph-scales"},
     high:{label:"High",detail:"Hard debugging and planning",icon:"ph-brain"},
     xhigh:{label:"Max",detail:"Deepest supported reasoning",icon:"ph-sparkle"},
    };
    const w = ctx.fns.w;
    const rows = caps.supported.map((effort) => {
     const info=copy[effort]!; const selected=effort===requested;
     return w.listRow({ label: info.label, detail: info.detail, icon: info.icon.replace(/^ph-/, ""), current: selected, hint: selected ? "current" : undefined,
       action: { post: `/agent/${encodeURIComponent(id)}/effort`, vals: { effort } }, attrs: { "data-action": "set-reasoning-effort" } });
    }).join("");
    const note = resolved.downgraded ? w.eventNote({ text: `Requested ${requested}; this model applies ${resolved.applied}.`, icon: "warning", tone: "warning" }) : "";
    const html = w.box({ mix: { layout: "stack", gap: "s3" }, body:
        w.box({ mix: { layout: "stack", gap: "s1" }, body: w.box({ body: esc(target.model), mix: { mono: true, text: "small", ink: "faint" } }) + w.box({ body: "Controls model-side reasoning for future turns of this agent.", mix: { ink: "muted" } }) })
        + w.list({ body: rows, label: "Reasoning effort" }) + note });
    return new Response(ctx.fns.ui.popupContent({title:"Reasoning effort",kind:"effort-picker",class:"w-full max-w-sm",html}),{headers:{"content-type":"text/html; charset=utf-8"}});
}
