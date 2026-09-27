/** List for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts?: {
        /** Include archived agents. @default false */
        includeArchived?: boolean;
        /** Listing policies to include. @default ["nav"] */
        visibility?: Array<"nav" | "team" | "hidden">;
}): Promise<Array<{
    id: string;
    model: string;
    title: string;
    turns: number;
    createdAt: number;
    updatedAt: number;
    workspaceDir: string;
    /** SSH host alias of the workspace; empty = local. */
    workspaceHost: string;
    runState: string;
    unread: number;
    archivedAt: number | null;
    parentId: string | null;
    visibility: "nav" | "team" | "hidden";
    delegated: boolean;
}>> {
    // Postgres folds unquoted aliases to lowercase — camelCase aliases must be quoted.
    // created_at / updated_at / COUNT(*) are BIGINTs and come back as strings → Number().
    //
    // `unread` counts only user-facing completion signals after the event
    // watermark: a non-empty assistant text response, or an explicit stop.
    // Tool calls, lifecycle updates, timers and other service events stay silent.
    const visibility = opts?.visibility?.length ? opts.visibility : ["nav"];
    const visibilitySql = visibility.map(() => "?").join(", ");
    const rows = (await ctx.fns.procs.db.select({
        sql: `SELECT
            a.id,
            a.model,
            a.title AS "explicitTitle",
            a.workspace_dir AS "workspaceDir",
            a.workspace_host AS "workspaceHost",
            a.run_state AS "runState",
            a.created_at AS "createdAt",
            a.archived_at AS "archivedAt",
            a.updated_at AS "updatedAt",
            a.parent_id AS "parentId",
            a.visibility,
            (a.visibility = 'team') AS delegated,
            COALESCE((SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.role = 'user'), 0) AS turns,
            COALESCE((SELECT COUNT(*) FROM events e WHERE e.agent_id = a.id
                AND e.ts > COALESCE(
                    (SELECT k.value::bigint FROM kv k WHERE k.key = 'seen-at:' || a.id),
                    (SELECT MAX(m.ts) FROM messages m WHERE m.agent_id = a.id AND m.idx <= COALESCE((SELECT k.value::int FROM kv k WHERE k.key = 'seen:' || a.id), -1)),
                    -1
                )
                AND ((e.type = 'assistant' AND NULLIF(BTRIM(e.payload::jsonb ->> 'text'), '') IS NOT NULL)
                  OR (e.type = 'error' AND (e.payload::jsonb ->> 'error') LIKE 'stopped by user%'))), 0) AS unread,
            (SELECT content FROM messages m WHERE m.agent_id = a.id AND m.role = 'user' ORDER BY idx LIMIT 1) AS "firstUser"
        FROM agents a
        WHERE a.visibility IN (${visibilitySql})
          ${opts?.includeArchived ? "" : "AND a.archived_at IS NULL"}
        ORDER BY a.updated_at DESC`,
        params: visibility,
    })) as any[];
    return rows.map((r: any) => ({
        id: r.id,
        model: r.model,
        title: r.explicitTitle || (r.firstUser ? String(r.firstUser).slice(0, 40) : '(empty)'),
        turns: Number(r.turns),
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        workspaceDir: r.workspaceDir || '',
        workspaceHost: r.workspaceHost || '',
        runState: r.runState || 'idle',
        unread: Number(r.unread),
        archivedAt: r.archivedAt == null ? null : Number(r.archivedAt),
        parentId: r.parentId == null ? null : String(r.parentId),
        visibility: r.visibility === "team" || r.visibility === "hidden" ? r.visibility : "nav",
        delegated: r.delegated === true || r.delegated === 't' || r.delegated === 1,
    }));
}
