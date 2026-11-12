/** Get full messages for the runtime. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
    id: string;
        /** Whether to include entries excluded from the processing cursor. */
    includeExcluded?: boolean },
): Promise<any[]> {
    const { id, includeExcluded } = opts;
    const rows = (await ctx.fns.procs.db.select({ sql: 'SELECT id, parent_id, fork_offset FROM agents WHERE id = ?', params: [id] })) as any[];
    const row = rows[0];
    if (!row) return [];

    const own = await ctx.fns.session.getMessages({ id, includeExcluded });
    // A fork cut at 0 inherits nothing: do not read the parent's whole transcript to slice it to [].
    if (!row.parent_id || (row.fork_offset != null && Number(row.fork_offset) === 0)) return own;

    const parent = await ctx.fns.session.getFullMessages({ id: row.parent_id, includeExcluded });
    const limited = row.fork_offset == null ? parent : parent.slice(0, row.fork_offset);
    return [...limited, ...own];
}
