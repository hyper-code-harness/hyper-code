/**
 * Lists lightweight agent cards for the global navigation menu
 *
 * Queries only active navigation-visible agents, supports ordered token-prefix and trigram-fuzzy title/id matching, ranks strong matches first, then orders by the latest substantive message. Use for latency-sensitive menu rendering instead of session.list, which computes transcript statistics.
 * @param opts.q Optional case-insensitive search text; whitespace-separated terms match in order and may each be a prefix.
 * @param opts.limit Maximum rows returned. @default 40 @minimum 1 @maximum 500
 * @param opts.owner Optional creator id used by the Mine scope.
 * @param opts.offset Rows skipped before the first returned card, for paging. @default 0 @minimum 0
 * @param opts.ids Optional exact agent ids to restrict the listing to (e.g. pinned chats).
 * @param opts.projectId Optional project id; only chats assigned to that project are returned.
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
        /** Rows skipped before the first returned card, for paging. @default 0 @minimum 0 */
        offset?: number;
        /** Optional exact agent ids to restrict the listing to (e.g. pinned chats). */
        ids?: string[];
        /** Optional project id; only chats assigned to that project are returned. */
        projectId?: string;
    },
): Promise<any[]> {
    const rows = await ctx.fns.agent.search({ query: opts.q, limit: opts.limit ?? 40, visibility: ["nav"], ...(opts.owner ? { owner: opts.owner } : {}), ...(opts.offset ? { offset: opts.offset } : {}), ...(opts.ids ? { ids: opts.ids } : {}), ...(opts.projectId ? { projectId: opts.projectId } : {}) });
    return rows.map(row => ({ ...row, turns: 0, delegated: false }));
}
