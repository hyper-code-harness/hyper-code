/**
 * Lists lightweight agent cards for the global navigation menu
 *
 * Queries only active navigation-visible agents, applies database-side title/id filtering and orders by the latest substantive message. Use for latency-sensitive menu rendering instead of session.list, which computes transcript statistics.
 * @param opts.q Optional case-insensitive agent id/title substring.
 * @param opts.limit Maximum rows returned. @default 40 @minimum 1 @maximum 500
 * @param opts.owner Optional creator id used by the Mine scope.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional case-insensitive agent id/title substring. */
        q?: string;
        /** Maximum rows returned. @default 40 @minimum 1 @maximum 500 */
        limit?: number;
        /** Optional creator id used by the Mine scope. */
        owner?: string;
    },
): Promise<any[]> {
    const q = (opts.q ?? "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 40)));
    const firstOwner = opts.owner ? (await ctx.fns.auth.listUsers({}).catch(() => [] as types.auth.User[])).find((user: types.auth.User) => user.role === "owner")?.id ?? null : null;
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT id, model, COALESCE(NULLIF(title, ''), id) AS title,
                     workspace_dir AS "workspaceDir", workspace_host AS "workspaceHost",
                     run_state AS "runState", created_by AS "createdBy",
                     last_message_at AS "lastMessageAt"
              FROM agents
              WHERE archived_at IS NULL AND visibility = 'nav'
                AND (? = '' OR lower(id || ' ' || COALESCE(title, '')) LIKE '%' || ? || '%')
                AND (? = '' OR created_by = ? OR (created_by IS NULL AND ? = ?))
              ORDER BY last_message_at DESC NULLS LAST, id
              LIMIT ?`,
        params: [q, q, opts.owner ?? "", opts.owner ?? "", opts.owner ?? "", firstOwner ?? "", limit],
    });
    return (rows as any[]).map(row => ({ ...row, unread: 0, turns: 0, parentId: null, visibility: "nav", delegated: false }));
}
