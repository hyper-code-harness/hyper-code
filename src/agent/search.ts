/**
 * Finds active agents quickly by id or title for messaging and navigation
 *
 * Performs indexed database-side prefix, ordered-term and trigram fuzzy matching over agent ids and titles. Use before agent.message when only a human name is known, and from latency-sensitive agent pickers. Hidden internal agents and compaction contexts are excluded by default.
 * @param opts.query Agent id or title words; ordered partial words and minor typos are supported.
 * @param opts.limit Maximum matches returned. @default 20 @minimum 1 @maximum 500
 * @param opts.visibility Listing classes to search; defaults to both user-facing and team agents.
 * @param opts.owner Optional creator id used by owner-scoped menus.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent id or title words; ordered partial words and minor typos are supported. */
        query?: string;
        /** Maximum matches returned. @default 20 @minimum 1 @maximum 500 */
        limit?: number;
        /** Listing classes to search; defaults to both user-facing and team agents. */
        visibility?: ("nav" | "team")[];
        /** Optional creator id used by owner-scoped menus. */
        owner?: string;
    },
): Promise<Array<{ id: string; title: string; model: string; runState: string; visibility: "nav" | "team"; parentId: string | null; workspaceDir: string; workspaceHost: string; createdBy: string | null; lastMessageAt: number | null }>> {
    const query = (opts.query ?? "").trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
    const sequence = terms.length ? `%${terms.map(escapeLike).join("%")}%` : "";
    const prefix = `${escapeLike(query)}%`;
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 20)));
    const visibility = opts.visibility?.length ? opts.visibility : ["nav", "team"];
    const visibilitySql = visibility.map(() => "?").join(", ");
    const firstOwner = opts.owner ? (await ctx.fns.auth.listUsers({}).catch(() => [] as types.auth.User[])).find((user: types.auth.User) => user.role === "owner")?.id ?? null : null;
    const rows = await ctx.fns.procs.db.select({
     sql: `SELECT id, COALESCE(NULLIF(title, ''), id) AS title, model,
                  run_state AS "runState", visibility, parent_id AS "parentId",
                  workspace_dir AS "workspaceDir", workspace_host AS "workspaceHost",
                  created_by AS "createdBy", last_message_at AS "lastMessageAt"
           FROM agents
           WHERE archived_at IS NULL AND visibility IN (${visibilitySql})
             AND title NOT LIKE '%· compact%'
             AND (? = '' OR lower(id || ' ' || COALESCE(title, '')) LIKE ? ESCAPE '\\'
                  OR public.word_similarity(?, lower(id || ' ' || COALESCE(title, ''))) >= 0.45)
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
     params: [...visibility, query, sequence, query, opts.owner ?? "", opts.owner ?? "", opts.owner ?? "", firstOwner ?? "", prefix, prefix, query, query, sequence, query, limit],
    });
    return (rows as any[]).map(row => ({ ...row, lastMessageAt: row.lastMessageAt == null ? null : Number(row.lastMessageAt) }));
}
