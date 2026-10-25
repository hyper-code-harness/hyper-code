// LLM page section for Hyper-to-Hyper sharing (docs/hyper-node.md): the nodes
// this instance relays through (client side) and the clients allowed to relay
// through it (host side). Tokens never appear here — only hints.
/**
 * Render the Hyper nodes section for the LLM connections page
 *
 * Shows configured nodes with model count, quota and errors plus an Add/Edit
 * popup, and the clients issued a token with usage counters, Issue and Revoke.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    const now = Date.now();
    const ago = (t: number | null) => t ? `${Math.max(1, Math.round((now - t) / 60000))}m ago` : "never";
    let nodes: types.node.NodeEntry[] = [], clients: Awaited<ReturnType<typeof ctx.fns.node.clients>> = [];
    try { nodes = await ctx.fns.node.list({}); clients = await ctx.fns.node.clients({}); } catch { /* tables absent */ }

    const nodeRows = nodes.map((n) => {
        const worst = [...(n.usage ?? [])].sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0];
        const quota = n.lastError ? `error: ${n.lastError}` : worst?.usedPercent != null ? `${Math.round(worst.usedPercent)}% used (${worst.provider})` : "usage unavailable";
        return ctx.fns.w.record({ entity: "hyper-node", id: n.name, status: n.lastError ? "error" : n.enabled ? "ready" : "neutral", cells: [
            { role: "name", text: `hyper/${n.name}:`, width: "name", mix: { mono: true, weight: "strong" } },
            { role: "url", text: n.url, title: n.url, grow: true, mix: { mono: true, text: "small", ink: "faint" } },
            { role: "models", text: `${n.catalog?.length ?? 0} models · ${ago(n.catalogAt)}`, mix: { text: "small", ink: "muted" } },
            { role: "quota", text: quota, tone: n.lastError ? "danger" : "success", mix: { text: "small" } },
        ], end: ctx.fns.w.button({ label: "Refresh", icon: "arrow-clockwise", tone: "neutral", size: "sm", action: { popup: { method: "node.refreshFromPopup", params: { name: n.name } } }, marks: { action: "open-popup" } }) + ctx.fns.w.button({ label: "Edit", icon: "gear", tone: "neutral", size: "sm", action: { popup: { method: "node.editPopup", params: { name: n.name } } }, marks: { action: "open-popup" } }) });
    }).join("");
    const clientRows = clients.map((c) => ctx.fns.w.record({ entity: "hyper-node-client", id: c.id, status: "ready", cells: [
        { role: "name", text: c.name, width: "name", mix: { mono: true, weight: "strong" } },
        { role: "hint", text: c.tokenHint, mix: { mono: true, text: "small", ink: "faint" } },
        { role: "providers", text: c.providers.length ? c.providers.join(", ") : "all providers", grow: true, mix: { text: "small", ink: "muted" } },
        { role: "requests", text: `${c.requests} req · used ${ago(c.lastUsedAt)}`, mix: { text: "small", ink: "muted" } },
    ], end: ctx.fns.w.button({ label: "Revoke", icon: "trash", tone: "danger", size: "sm", action: { popup: { method: "node.revokeFromPopup", params: { id: c.id, name: c.name } } }, marks: { action: "open-popup" } }) })).join("");

    const nodesHead = ctx.fns.w.heading({ title: "Hyper nodes", meta: "Other Hyper instances whose models you use as hyper/&lt;node&gt;:&lt;model&gt;.", actions: ctx.fns.w.button({ label: "Add node", icon: "plus", tone: "neutral", size: "sm", action: { popup: { method: "node.editPopup", params: {} } }, marks: { action: "open-popup" } }) });
    const clientsHead = ctx.fns.w.heading({ title: "Shared with", meta: "Hyper instances allowed to relay through your providers.", actions: ctx.fns.w.button({ label: "Issue token", icon: "key", tone: "neutral", size: "sm", action: { popup: { method: "node.issuePopup", params: {} } }, marks: { action: "open-popup" } }) });
    const box = (rows: string, empty: string) => ctx.fns.w.card({ body: rows || ctx.fns.w.empty({ title: empty, icon: "tray" }), flush: true });
    const html = ctx.fns.w.box({ body: `<section>${nodesHead}${box(nodeRows, "No nodes")}</section><section>${clientsHead}${box(clientRows, "Nobody yet")}</section>`, mix: { layout: "stack", gap: "s6" } });
    return ctx.fns.ui.live({ id: "hyper-nodes", url: "/node/card", topic: "node-clients", swap: "outerMorph", every: 30, attrs: 'class="block"', html });
}
