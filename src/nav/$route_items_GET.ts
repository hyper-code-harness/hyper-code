// GET /nav/items?q=… — compact overview/search results for the global menu.
/**
 * Renders navigation menu items, optionally filtered by a search query.
 * @param opts.req Incoming HTTP request containing the optional `q` query.
 * @param opts.params Route parameters supplied by the HTTP runtime.
 */

export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const q = new URL(opts.req.url).searchParams.get("q")?.trim() ?? "";
    const items = await ctx.fns.nav.items({ q, limit: q ? 40 : 500 });
    const sharedAgents = await ctx.fns.sharedAgent.list({ query: q });
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const agents = await ctx.fns.session.list({}).catch(() => [] as any[]);
    const visibleAgents = agents;
    const pinnedIds = new Set(((await ctx.fns.procs.db.select({ sql: "SELECT substring(key FROM 18) AS id FROM kv WHERE key LIKE 'mobile-pin-agent:%'", params: [] })) as any[]).map(row => String(row.id)));
    const childrenByParent = new Map<string, any[]>();
    const agentByHref = new Map(agents.map((agent: any) => [`/agent/${encodeURIComponent(agent.id)}`, agent]));
    const hotAgents = (await ctx.fns.procs.db.select({
        sql: `SELECT a.id FROM kv h JOIN agents a ON a.id = substring(h.key FROM 5) WHERE h.key LIKE 'hot:%' AND a.archived_at IS NULL ORDER BY h.value::bigint DESC LIMIT 10`,
        params: [],
    }) as any[]).map((row: any) => agents.find((agent: any) => String(agent.id) === String(row.id))).filter(Boolean);
    const group = (item: any) => {
        if (item.group === "Pages") return "Pages";
        if (item.group) {
            const declared = String(item.group);
            return ["Chats", "Shared Agents", "Projects & files", "Plugins", "System"].includes(declared) ? declared : "Pages";
        }
        const hint = String(item.hint ?? "").toLowerCase();
        if (hint.includes("agent")) return "Chats";
        if (item.href === "/files" || hint.includes("project") || hint.includes("file")) return "Projects & files";
        if (hint.includes("plugin")) return "Plugins";
        return "System";
    };
    const row = (item: any) => {
        const agent: any = agentByHref.get(item.href);
        if (agent) {
            const active = agent.runState !== "idle";
            const badge = Number(agent.unread ?? 0) > 0
                ? `<span class="min-w-[1.1rem] shrink-0 rounded-full bg-success px-1 text-center text-3xs font-semibold leading-4 text-white">${agent.unread > 99 ? "99+" : agent.unread}</span>`
                : "";
            const pinned = pinnedIds.has(String(agent.id));
            const pinControl = `<form hx-post="/nav/agent/${encodeURIComponent(agent.id)}/pin" hx-swap="none" class="shrink-0"><input type="hidden" name="pinned" value="${pinned ? "0" : "1"}"><button type="submit" title="${pinned ? "Unpin" : "Pin"} agent" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(agent.title || agent.id)}" class="flex size-6 items-center justify-center rounded text-faint hover:bg-base-200 hover:text-warning"><i class="ph ${pinned ? "ph-push-pin-slash text-error" : "ph-push-pin"}"></i></button></form>`;
            return `<div class="group flex items-center gap-0.5"><a href="${esc(item.href)}" class="nav-row flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left outline-none hover:bg-base-200">
  ${ctx.fns.ui.modelLogo({ model: agent.model, active, bare: true, compact: true })}
  <span class="min-w-0 flex-1 truncate text-xs text-muted">${pinned ? '<i class="ph ph-push-pin-fill mr-1 text-warning" aria-label="Pinned"></i>' : ''}${esc(agent.title || agent.id)} <span class="font-mono text-3xs font-normal text-faint">(${esc(agent.id)})</span></span>
  ${badge}
</a>${pinControl}</div>`;
        }
        return `<a href="${esc(item.href)}" class="nav-row flex min-h-8 items-center gap-2 rounded px-2 py-1 text-sm outline-none hover:bg-base-200/60">
  <i class="ph ${esc(item.icon || (group(item) === "Projects & files" ? "ph-folder" : group(item) === "Plugins" ? "ph-plugs" : "ph-gear"))} shrink-0 text-faint"></i>
  <span class="min-w-0 flex-1 truncate">${esc(item.label)}</span>
  ${item.hint ? `<span class="max-w-32 shrink-0 truncate text-3xs text-faint">${esc(item.hint)}</span>` : ""}
</a>`;
    };
    let html: string;
    const workspaceLabel = (dir: string) => dir.split("/").filter(Boolean).pop() || dir;
    const agentGroups = new Map<string, any[]>();
    for (const agent of visibleAgents as any[]) {
        const dir = String(agent.workspaceDir || "");
        const key = dir || "(no workdir)";
        const list = agentGroups.get(key) ?? [];
        list.push(agent);
        agentGroups.set(key, list);
    }
    const agentRow = (agent: any, nested = false) => row({ href: `/agent/${encodeURIComponent(agent.id)}`, label: agent.title || agent.id, hint: nested ? "subagent" : "agent" });
    const quickAgentRow = (agent: any) => {
        const active = agent.runState !== "idle";
        const badge = Number(agent.unread ?? 0) > 0
            ? `<span class="min-w-[1.1rem] shrink-0 rounded-full bg-success px-1 text-center text-3xs font-semibold leading-4 text-white">${agent.unread > 99 ? "99+" : agent.unread}</span>`
            : "";
        return `<a href="/agent/${encodeURIComponent(agent.id)}" class="nav-row flex min-h-7 items-center gap-1.5 rounded px-1.5 py-0.5 text-left outline-none hover:bg-base-200">${ctx.fns.ui.modelLogo({ model: agent.model, active, bare: true, compact: true })}<span class="min-w-0 flex-1 truncate text-xs text-muted">${esc(agent.title || agent.id)} <span class="font-mono text-3xs font-normal text-faint">(${esc(agent.id)})</span></span>${badge}</a>`;
    };
    const pinnedAgents = visibleAgents.filter((agent: any) => pinnedIds.has(String(agent.id)));
    const unreadAgents = visibleAgents.filter((agent: any) => !pinnedIds.has(String(agent.id)) && Number(agent.unread ?? 0) > 0);
    const chats = () => `${pinnedAgents.length ? `<section class="mb-2"><h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider text-warning">Pinned</h4>${pinnedAgents.map(agent => agentRow(agent)).join("")}</section>` : ""}${unreadAgents.length ? `<section class="mb-2"><h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider text-success">Unread</h4>${unreadAgents.map(agent => agentRow(agent)).join("")}</section>` : ""}${[...agentGroups.entries()].map(([dir, list]) => `<section class="mb-2">
  ${dir === "(no workdir)"
      ? `<h4 class="mb-0.5 px-1.5 text-3xs font-semibold text-faint">${dir}</h4>`
      : `<a href="/files?path=${encodeURIComponent(dir)}" class="nav-row mb-0.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-semibold text-subtle hover:bg-base-200"><i class="ph ph-folder-open"></i><span class="truncate">${esc(workspaceLabel(dir))}</span></a>`}
  ${list.map((parent: any) => `${agentRow(parent)}${(childrenByParent.get(String(parent.id)) ?? []).map((child: any) => `<div class="ml-5 border-l border-ui-border pl-1">${agentRow(child, true)}</div>`).join("")}`).join("")}
</section>`).join("")}`;
    const projects = () => {
        const folders = [...agentGroups.entries()].filter(([dir]) => dir !== "(no workdir)");
        return folders.map(([dir, list]) => `<a href="/files?path=${encodeURIComponent(dir)}" class="nav-row flex min-h-8 items-center gap-2 rounded px-2 py-1 text-sm outline-none hover:bg-base-200/60">
  <i class="ph ph-folder-open shrink-0 text-faint"></i>
  <span class="min-w-0 flex-1 truncate">${esc(workspaceLabel(dir))}</span>
  <span class="shrink-0 text-3xs text-faint">${list.length} ${list.length === 1 ? "agent" : "agents"}</span>
</a>`).join("");
    };

    const sharedAgentRows = () => sharedAgents.map((card: any) => `<a href="/shared-agents?agent=${encodeURIComponent(card.agentId)}" class="nav-row flex min-h-10 items-start gap-2 rounded px-2 py-1.5 text-left outline-none hover:bg-base-200/60"><i class="ph ph-brain mt-0.5 shrink-0 text-primary"></i><span class="min-w-0 flex-1"><span class="block truncate text-xs font-medium text-muted">${esc(card.name)}</span><span class="block truncate text-3xs text-faint">${esc((card.capabilities ?? []).join(" · ") || card.description)}</span></span><span class="font-mono text-micro text-faint">${esc(card.agentId)}</span></a>`).join("");

    if (q) {
        html = `<div class="p-2">${sharedAgentRows()}${items.map(row).join("")}</div>`;
    } else {
        const newAgent = `<a href="/agent/new" class="nav-row mb-1 flex min-h-10 items-center gap-2 rounded-lg border border-ui-border bg-base-100/35 px-3 py-2 text-left text-base-content shadow-sm outline-none transition hover:border-ui-border-strong hover:bg-base-100/60 hover:text-primary"><i class="ph ph-plus-circle shrink-0 text-lg text-primary" aria-hidden="true"></i><span class="min-w-0 flex-1 text-xs">New agent</span></a>`;
        const quick = `<section class="mb-3 border-b border-ui-border pb-2">${newAgent}${hotAgents.map((agent: any) => quickAgentRow(agent)).join("")}</section>`;
        const columns = [
            { title: "Chats", content: `${quick}${chats()}` },
            { title: "Shared Agents", content: `${items.filter(item => group(item) === "Shared Agents").map(row).join("")}${sharedAgentRows()}` },
            { title: "Pages", content: items.filter(item => group(item) === "Pages").map(row).join("") },
            { title: "Projects & files", content: `${projects()}${items.filter(item => group(item) === "Projects & files").map(row).join("")}` },
            { title: "System", content: `${items.filter(item => group(item) === "System").map(row).join("")}<h4 class="mb-1 mt-3 px-2 text-3xs font-semibold uppercase tracking-wider text-faint">Plugins</h4>${items.filter(item => group(item) === "Plugins").map(row).join("")}` },
        ];
        html = `<div class="grid grid-cols-1 divide-y divide-base-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">${columns.map(column => `<section class="min-w-0 p-2.5"><h3 class="mb-1 px-2 text-3xs font-semibold uppercase tracking-wider text-faint">${column.title}</h3>${column.content || `<div class="px-2 py-2 text-xs text-faint">empty</div>`}</section>`).join("")}</div>`;
    }
    return new Response(html || `<div class="px-4 py-5 text-sm text-faint">nothing</div>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}
