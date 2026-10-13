export const hint = "Hyper's live module dependency map with core/plugin filters, cycle and ownership-boundary highlighting — args `{ scope?: \"all\"|\"core\"|\"plugins\", minWeight?: number }`";

export default {
    icon: "graph",
    live: true,
    prepare(_ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const scope = ["all", "core", "plugins"].includes(String(opts.args.scope)) ? String(opts.args.scope) : "all";
        const minWeight = Math.max(1, Math.min(50, Number(opts.args.minWeight) || 2));
        return { args: { scope, minWeight }, title: "Hyper Architecture Map" };
    },
    render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
        const state = { ...opts.item.args, ...opts.item.state };
        const query = new URLSearchParams({ embed: "1", scope: String(state.scope ?? "all"), minWeight: String(state.minWeight ?? 2) });
        return `<iframe data-canvas-frame="${opts.item.id}" src="/architectureMap?${esc(query.toString())}" title="${esc(opts.item.title)}" class="block h-full w-full border-0 bg-base-100" loading="eager"></iframe>`;
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const state = { ...opts.item.args, ...opts.item.state };
        return `live Hyper architecture map — scope ${state.scope ?? "all"}, minimum edge weight ${state.minWeight ?? 2}`;
    },
} satisfies types.canvas.Kind;
