/**
 * Lists active Hyper agents for the native mobile client.
 *
 * Query: `q` (search text, as nav.agents), `limit` (default 50, max 500), `offset` (paging), `projectId` (only that
 * project's chats). The first page (offset 0) always includes the viewer's pinned chats matching q/projectId, even when
 * they fall outside the recent window; they are appended after the recent rows, de-duplicated.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const query = new URL(opts.req.url).searchParams;
    const q = query.get("q")?.trim() || undefined;
    const projectId = query.get("projectId")?.trim() || undefined;
    const intParam = (name: string, fallback: number) => {
        const value = Number.parseInt(query.get(name) ?? "", 10);
        return Number.isFinite(value) ? value : fallback;
    };
    const limit = Math.max(1, Math.min(500, intParam("limit", 50)));
    const offset = Math.max(0, intParam("offset", 0));
    const [pins, mentions, projects] = await Promise.all([
        ctx.fns.auth.pinnedIds({}),
        ctx.fns.mentions.unreadByAgent({}),
        ctx.fns.project.list({}),
    ]);
    // One extra row tells whether another page exists.
    const page = await ctx.fns.nav.agents({ limit: limit + 1, ...(q ? { q } : {}), ...(offset ? { offset } : {}), ...(projectId ? { projectId } : {}) });
    const hasMore = page.length > limit;
    const agents = page.slice(0, limit);
    const shown = new Set(agents.map(agent => String(agent.id)));
    const missingPins = offset === 0 ? [...pins].filter(id => !shown.has(id)) : [];
    if (missingPins.length) {
        const pinned = await ctx.fns.nav.agents({ ids: missingPins, limit: 500, ...(q ? { q } : {}), ...(projectId ? { projectId } : {}) });
        for (const agent of pinned) if (!shown.has(String(agent.id))) { shown.add(String(agent.id)); agents.push(agent); }
    }
    const ids = agents.map(agent => agent.id);
    const projectRows = ids.length ? await ctx.fns.procs.db.select({
        sql: `SELECT id, project_id AS "projectId" FROM agents WHERE id IN (${ids.map(() => "?").join(", ")})`,
        params: ids,
    }) as any[] : [];
    const projectIdByAgent = new Map(projectRows.map(row => [String(row.id), row.projectId == null ? null : String(row.projectId)]));
    const projectById = new Map(projects.map(project => [project.id, project]));
    return Response.json({
        version: 1,
        offset,
        limit,
        hasMore,
        agents: agents.map(agent => ({
            id: agent.id,
            title: agent.title,
            model: agent.model,
            runState: agent.runState,
            unread: agent.hasUnread ? 1 : 0,
            mentions: Number(mentions[agent.id] ?? 0),
            turns: agent.turns ?? 0,
            updatedAt: agent.lastMessageAt ?? 0,
            workspaceDir: agent.workspaceDir,
            projectId: projectIdByAgent.get(agent.id) ?? null,
            projectTitle: projectIdByAgent.get(agent.id) ? projectById.get(projectIdByAgent.get(agent.id)!)?.title ?? null : null,
            pinned: pins.has(agent.id),
            delegated: agent.delegated,
            visibility: agent.visibility,
        })),
    });
}
