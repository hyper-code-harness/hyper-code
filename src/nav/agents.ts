/**
 * Lists lightweight agent cards for the global navigation menu
 *
 * Queries only active navigation-visible agents, supports ordered token-prefix and trigram-fuzzy title/id matching, ranks strong matches first, then orders by the latest substantive message. Use for latency-sensitive menu rendering instead of session.list, which computes transcript statistics.
 * @param opts.q Optional case-insensitive search text; whitespace-separated terms match in order and may each be a prefix.
 * @param opts.limit Maximum rows returned. @default 40 @minimum 1 @maximum 500
 * @param opts.owner Optional creator id used by the Mine scope.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional case-insensitive search text; ordered terms may each be prefixes. */
        q?: string;
        /** Maximum rows returned. @default 40 @minimum 1 @maximum 500 */
        limit?: number;
        /** Optional creator id used by the Mine scope. */
        owner?: string;
    },
): Promise<any[]> {
    const q = (opts.q ?? "").trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
    // "pin xxx yyy" becomes "%pin%xxx%yyy%": ordered partial terms without
    // requiring them to be adjacent. Trigram matching additionally tolerates typos.
    const sequence = terms.length ? `%${terms.map(escapeLike).join("%")}%` : "";
    const prefix = `${escapeLike(q)}%`;
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 40)));
    const firstOwner = opts.owner ? (await ctx.fns.auth.listUsers({}).catch(() => [] as types.auth.User[])).find((user: types.auth.User) => user.role === "owner")?.id ?? null : null;
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT id, model, COALESCE(NULLIF(title, ''), id) AS title,
                     workspace_dir AS "workspaceDir", workspace_host AS "workspaceHost",
                     run_state AS "runState", created_by AS "createdBy",
                     last_message_at AS "lastMessageAt"
              FROM agents
              WHERE archived_at IS NULL AND visibility = 'nav'
                AND (? = '' OR lower(id || ' ' || COALESCE(title, '')) LIKE ? ESCAPE '\\'
                    OR ? OPERATOR(public.<%) lower(id || ' ' || COALESCE(title, '')))
                AND (? = '' OR created_by = ? OR (created_by IS NULL AND ? = ?))
              ORDER BY CASE
                         WHEN lower(id) LIKE ? ESCAPE '\\' OR lower(COALESCE(title, '')) LIKE ? ESCAPE '\\' THEN 0
                         WHEN lower(id) = ? OR lower(COALESCE(title, '')) = ? THEN 1
                         WHEN lower(id || ' ' || COALESCE(title, '')) LIKE ? ESCAPE '\\' THEN 2
                         ELSE 3
                       END,
                       public.word_similarity(?, lower(id || ' ' || COALESCE(title, ''))) DESC,
                       last_message_at DESC NULLS LAST, id
              LIMIT ?`,
        params: [q, sequence, q, opts.owner ?? "", opts.owner ?? "", opts.owner ?? "", firstOwner ?? "", prefix, prefix, q, q, sequence, q, limit],
    });
    return (rows as any[]).map(row => ({ ...row, unread: 0, turns: 0, parentId: null, visibility: "nav", delegated: false }));
}
