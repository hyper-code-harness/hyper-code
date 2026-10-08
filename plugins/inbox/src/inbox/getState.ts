/**
 * Reads one inbox plugin state value from inbox.state; null when absent.
 * @param opts.key State key such as cursor.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** State key such as cursor. */
    key: string;
}): Promise<any> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT value FROM inbox.state WHERE key = ?", params: [opts.key] }) as any[];
    const v = rows[0]?.value;
    return v == null ? null : typeof v === "string" ? JSON.parse(v) : v;
}
