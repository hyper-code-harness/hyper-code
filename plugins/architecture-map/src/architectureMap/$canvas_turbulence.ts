export const hint = "live churn-versus-complexity map for Hyper source files — args `{ root?: string }`";
export default {
  view: "architectureMap.turbulencePage",
  icon: "chart-scatter",
  live: true,
  prepare(_ctx: Context, opts: { agentId: string; args: Record<string, any> }) { return { args: opts.args.root ? { root: String(opts.args.root) } : {}, title: "Hyper Turbulence" }; },
  render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) { const esc=(text:string)=>ctx.fns.w.escape({text}); const q=new URLSearchParams({embed:"1"}); if(opts.item.args.root)q.set("root",String(opts.item.args.root)); return `<iframe data-canvas-frame="${opts.item.id}" src="/architectureMap/turbulence?${esc(q.toString())}" title="${esc(opts.item.title)}" class="block h-full w-full border-0 bg-base-100" loading="eager"></iframe>`; },
  describe(_ctx: Context, opts: { item: types.canvas.Item }) { return `live turbulence map${opts.item.args.root ? ` for ${opts.item.args.root}` : " for all Hyper source roots"}`; },
} satisfies types.canvas.Kind;
