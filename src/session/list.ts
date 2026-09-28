/** List for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts?: {
        /** Include archived agents. @default false */
        includeArchived?: boolean;
        /** Only chats created by this user id ("mine"). Chats created before users existed count as the first owner's. */
        owner?: string;
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
    /** User id of the chat's creator; null for chats created before users existed. */
    createdBy: string | null;
}>> {
    // Postgres folds unquoted aliases to lowercase — camelCase aliases must be quoted.
    // created_at / updated_at / COUNT(*) are BIGINTs and come back as strings → Number().
    //
    // `unread` counts only user-facing completion signals after the event
    // watermark: a non-empty assistant text response, or an explicit stop.
    // Tool calls, lifecycle updates, timers and other service events stay silent.
    const visibility = opts?.visibility?.length ? opts.visibility : ["nav"];
    // Unread is per viewer (user_agent_state). The shared kv watermark is the fallback only while
    // there is at most one user, so a single-user Hyper reads exactly as before.
    const users = await ctx.fns.auth.listUsers({}).catch(() => [] as types.auth.User[]);
    const viewer = await ctx.fns.auth.viewerId({}).catch(() => null);
    const legacyKv = users.length <= 1;
    const firstOwner = users.find((u) => u.role === "owner")?.id ?? null;
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
            a.created_by AS "createdBy",
            COALESCE((SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.role = 'user'), 0) AS turns,
            COALESCE((SELECT COUNT(*) FROM events e WHERE e.agent_id = a.id
                AND e.ts > COALESCE(
                    (SELECT s.seen_at FROM user_agent_state s WHERE s.user_id = ? AND s.agent_id = a.id),
                    (SELECT k.value::bigint FROM kv k WHERE k.key = 'seen-at:' || a.id AND ? = 1),
                    (SELECT MAX(m.ts) FROM messages m WHERE m.agent_id = a.id AND m.idx <= COALESCE((SELECT k.value::int FROM kv k WHERE k.key = 'seen:' || a.id), -1)),
                    -1
                )
                AND ((e.type = 'assistant' AND NULLIF(BTRIM(e.payload::jsonb ->> 'text'), '') IS NOT NULL)
                  OR (e.type = 'error' AND (e.payload::jsonb ->> 'error') LIKE 'stopped by user%'))), 0) AS unread,
            (SELECT content FROM messages m WHERE m.agent_id = a.id AND m.role = 'user' ORDER BY idx LIMIT 1) AS "firstUser"
        FROM agents a
        WHERE a.visibility IN (${visibilitySql})
          ${opts?.includeArchived ? "" : "AND a.archived_at IS NULL"}
          ${opts?.owner ? "AND (a.created_by = ? OR (a.created_by IS NULL AND ? = ?))" : ""}
        ORDER BY a.updated_at DESC`,
        params: [viewer ?? "", legacyKv ? 1 : 0, ...visibility, ...(opts?.owner ? [opts.owner, opts.owner, firstOwner ?? ""] : [])],
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
        createdBy: r.createdBy == null ? null : String(r.createdBy),
    }));
}
