/**
 * Renders the reasoning effort picker for one agent header
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
    const esc = (x:any) => ctx.fns.procs.ui.escape({ text: String(x ?? "") });
    const copy: Record<string, { label: string; detail: string; icon: string }> = {
     auto:{label:"Auto",detail:`Model recommendation · ${resolved.applied}`,icon:"ph-magic-wand"},
     off:{label:"Off",detail:"Fastest; no deliberate reasoning",icon:"ph-lightning"},
     minimal:{label:"Minimal",detail:"Very quick checks",icon:"ph-gauge"},
     low:{label:"Low",detail:"Fast and quota-conscious",icon:"ph-leaf"},
     medium:{label:"Medium",detail:"Balanced for most work",icon:"ph-scales"},
     high:{label:"High",detail:"Hard debugging and planning",icon:"ph-brain"},
     xhigh:{label:"Max",detail:"Deepest supported reasoning",icon:"ph-sparkle"},
    };
    const rows = caps.supported.map((effort) => {
     const info=copy[effort]!; const selected=effort===requested;
     const html=`<i class="ph ${info.icon} text-base" aria-hidden="true"></i><span class="min-w-0 flex-1"><span class="block text-xs font-medium">${esc(info.label)}</span><span class="block text-3xs text-faint">${esc(info.detail)}</span></span>${selected?'<i class="ph ph-check-circle text-primary" aria-hidden="true"></i>':''}`;
     return `<form hx-post="/agent/${encodeURIComponent(id)}/effort" hx-swap="none"><input type="hidden" name="effort" value="${effort}">${ctx.fns.procs.ui.button({action:"set-reasoning-effort",html,type:"submit",disabled:selected,class:`flex w-full items-center gap-3 rounded-lg text-left ${selected?"border-primary/30 bg-primary/10 text-primary":"text-muted"}`,attrs:selected?{"aria-current":"true"}:{}})}</form>`;
    }).join("");
    const note = resolved.downgraded ? `<div class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-3xs text-warning">Requested ${esc(requested)}; this model applies ${esc(resolved.applied)}.</div>` : "";
    const html=`<div class="space-y-3"><div><div class="font-mono text-3xs text-faint">${esc(target.model)}</div><div class="mt-1 text-xs text-subtle">Controls model-side reasoning for future turns of this agent.</div></div><div class="grid gap-1.5">${rows}</div>${note}</div>`;
    return new Response(ctx.fns.ui.popupContent({title:"Reasoning effort",kind:"effort-picker",class:"w-full max-w-sm",html}),{headers:{"content-type":"text/html; charset=utf-8"}});
}
