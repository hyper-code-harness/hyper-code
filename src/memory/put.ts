/**
 * Store a structured JSON memory record under a key on one of the four memory levels
 *
 * Upserts a type 'jsonb' memory row: the content lives in data, with title, description and a free-form kind.
 * Use for collections of similar structured items (todos, bugs with status, people from a meeting) that need
 * filtering rather than prose; use memory.write for notes. Levels as in memory.write: agent (default), user (this
 * agent's person, in every project), project, system (instance owner's agents only).
 * @param opts.key Unique key within the level, e.g. bugs/canvas-reload.
 * @param opts.data JSON-compatible content to store.
 * @param opts.title Short human title shown in listings.
 * @param opts.description One line for the table of contents and search. @default
 * @param opts.visibility Level: agent, user, project or system. @default agent
 * @param opts.kind Free-form kind chosen by the agent, e.g. bug, person, todo.
 * @param opts.meta Extra metadata merged into meta, e.g. basis, status, tags.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique key within the level, e.g. bugs/canvas-reload. */
        key: string;
        /** JSON-compatible content to store. */
        data: unknown;
        /** Short human title shown in listings. */
        title: string;
        /** One line for the table of contents and search. @default  */
        description?: string;
        /** Level: agent, user, project or system. @default agent */
        visibility?: "agent" | "user" | "project" | "system";
        /** Free-form kind chosen by the agent, e.g. bug, person, todo. */
        kind?: string;
        /** Extra metadata merged into meta, e.g. basis, status, tags. */
        meta?: Record<string, unknown>;
    },
): Promise<{ id: number; key: string; visibility: "agent" | "user" | "project" | "system"; version: number }> {
    const lv = await ctx.fns.memory.level({ visibility: opts.visibility, action: "memory.put" });
    const now = Date.now();
    const meta = { ...(opts.meta ?? {}), source: { agentId: lv.writer } };
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `insert into memory (visibility, project_id, user_id, agent_id, key, type, kind, title, description, url, meta, data, created_by, created_at, updated_at)
              values (?, ?, ?, ?, ?, 'jsonb', ?, ?, ?, null, ?::jsonb, ?::jsonb, ?, ?, ?)
              on conflict (visibility, coalesce(project_id, ''), coalesce(user_id, ''), coalesce(agent_id, ''), key) do update set
                type = excluded.type, kind = excluded.kind, title = excluded.title, description = excluded.description,
                meta = memory.meta || excluded.meta, data = excluded.data, updated_at = excluded.updated_at, version = memory.version + 1
              returning id, version`,
        params: [lv.visibility, lv.projectId, lv.userId, lv.agentId, opts.key, opts.kind ?? null, opts.title, opts.description ?? "", JSON.stringify(meta), JSON.stringify(opts.data ?? null), lv.writer, now, now],
    });
    return { id: Number(rows[0].id), key: opts.key, visibility: lv.visibility, version: Number(rows[0].version) };
}
