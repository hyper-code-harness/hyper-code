/**
 * Stores one inbox plugin state value (cursor, registration) in inbox.state.
 * @param opts.key State key such as cursor.
 * @param opts.value JSON value.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** State key such as cursor. */
    key: string;
    /** JSON value. */
    value: unknown;
}): Promise<void> {
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO inbox.state (key, value, updated_at) VALUES (?, ?::jsonb, ?)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        params: [opts.key, JSON.stringify(opts.value), Date.now()],
    });
}
