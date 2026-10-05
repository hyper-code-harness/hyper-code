// GET /nav/items?q=… — compact overview/search results for the global menu.
/**
 * Renders navigation menu items, optionally filtered by a search query.
 * @param opts.req Incoming HTTP request containing the optional `q` query.
 * @param opts.params Route parameters supplied by the HTTP runtime.
 */

export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const q = new URL(opts.req.url).searchParams.get("q")?.trim() ?? "";
    const users = await ctx.fns.auth.listUsers({}).catch(() => [] as any[]);
    const me = (_session as any)?.user?.id as string | undefined;
    const multi = users.length > 1 && !!me;
    const scope = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get("hyper_nav_scope") === "all" ? "all" : "mine";
    const agents = await ctx.fns.nav.agents({ q, limit: q ? 40 : 500, ...(multi && scope === "mine" ? { owner: me } : {}) }).catch(() => [] as any[]);
    const [items, sharedAgents, pinnedIds] = await Promise.all([
        ctx.fns.nav.items({ q, limit: q ? 40 : 500, includeAgents: false }),
        ctx.fns.sharedAgent.list({ query: q }),
        ctx.fns.auth.pinnedIds({}),
    ]);
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const visibleAgents = agents;
    const names = new Map(users.map((u: any) => [u.id, u.name]));
    const agentByHref = new Map(agents.map((agent: any) => [`/agent/${encodeURIComponent(agent.id)}`, agent]));
    const scopeToggle = () => {
        const btn = (value: string, label: string) => `<button type="button" onclick="document.cookie='hyper_nav_scope=${value};path=/;max-age=31536000;samesite=lax';htmx.trigger(document.body,'nav-refresh')" class="flex-1 rounded px-2 py-1 text-3xs ${scope === value ? "bg-base-100 font-semibold text-base-content shadow-sm" : "text-faint hover:text-muted"}" aria-pressed="${scope === value}">${label}</button>`;
        return `<div class="mb-2 flex gap-1 rounded-lg bg-base-200 p-0.5" role="group" aria-label="Show chats">${btn("mine", "Mine")}${btn("all", "All")}</div>`;
    };
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
            const badge = agent.hasUnread
                ? `<span class="size-2 shrink-0 rounded-full bg-success" title="New activity" aria-label="New activity"></span>`
                : "";
            const pinned = pinnedIds.has(String(agent.id));
            const pinControl = `<form hx-post="/nav/agent/${encodeURIComponent(agent.id)}/pin" hx-swap="none" class="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60 hover:!opacity-100"><input type="hidden" name="pinned" value="${pinned ? "0" : "1"}"><button type="submit" title="${pinned ? "Unpin" : "Pin"} agent" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(agent.title || agent.id)}" class="flex size-6 items-center justify-center rounded text-faint hover:bg-base-200 hover:text-muted"><i class="ph ${pinned ? "ph-push-pin-slash" : "ph-push-pin"}"></i></button></form>`;
            return `<div class="group flex items-center gap-0.5"><a href="${esc(item.href)}" class="nav-row flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-0.5 text-left outline-none hover:bg-base-200">
  ${ctx.fns.ui.modelLogo({ model: agent.model, active, bare: true, compact: true })}
  <span class="min-w-0 flex-1 truncate text-xs text-muted">${pinned ? '<i class="ph ph-push-pin-fill mr-1 text-faint opacity-50" aria-label="Pinned"></i>' : ''}${esc(agent.title || agent.id)} <span class="font-mono text-3xs font-normal text-faint">(${esc(agent.id)})</span></span>
  ${multi && agent.createdBy && agent.createdBy !== me ? `<span class="max-w-24 shrink-0 truncate text-3xs text-faint" data-owner="${esc(agent.createdBy)}">${esc(names.get(agent.createdBy) ?? agent.createdBy)}</span>` : ""}
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
        const host = String(agent.workspaceHost || "");
        const key = dir ? (host ? `${host}:${dir}` : dir) : "(no workdir)";
        const list = agentGroups.get(key) ?? [];
        list.push(agent);
        agentGroups.set(key, list);
    }
    const agentRow = (agent: any) => row({ href: `/agent/${encodeURIComponent(agent.id)}`, label: agent.title || agent.id, hint: "agent" });
    const pinnedAgents = visibleAgents.filter((agent: any) => pinnedIds.has(String(agent.id)));
    // The main chat column is a pure activity feed. Pinning does not perturb or
    // remove a chat from recency; pinned shortcuts live beside Shared Agents.
    const recentAgents = visibleAgents.slice(0, 50);
    const chats = () => `<section class="mb-2"><h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider text-faint">Recent</h4>${recentAgents.map(agent => agentRow(agent)).join("")}</section>`;
    const pinned = () => pinnedAgents.length ? `<section class="mb-3"><h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider text-warning">Pinned</h4>${pinnedAgents.map(agent => agentRow(agent)).join("")}</section>` : "";
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
        const agentItems = agents.map((agent: any) => ({ href: `/agent/${encodeURIComponent(agent.id)}`, label: agent.title || agent.id, hint: "agent", group: "Chats" }));
        html = `<div class="p-2">${sharedAgentRows()}${[...agentItems, ...items].map(row).join("")}</div>`;
    } else {
        const newAgent = `<a href="/agent/new" data-nav-default class="nav-row mb-1 flex min-h-10 items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left text-primary shadow-sm outline-none transition hover:bg-primary/15 focus:bg-primary/15"><i class="ph ph-plus-circle shrink-0 text-lg" aria-hidden="true"></i><span class="min-w-0 flex-1 text-xs font-medium">New agent</span></a>`;
        const quick = `<section class="mb-3 border-b border-ui-border pb-2">${newAgent}</section>`;
        const columns = [
            { title: "Chats", content: `${multi ? scopeToggle() : ""}${quick}${chats()}` },
            { title: "Shared Agents", content: `${pinned()}${items.filter(item => group(item) === "Shared Agents").map(row).join("")}${sharedAgentRows()}` },
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
