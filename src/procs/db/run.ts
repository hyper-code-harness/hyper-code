// INSERT / UPDATE / DELETE → { changes, lastInsertRowid, rows }.
// `changes` comes from the command tag; `lastInsertRowid` has no Postgres
// equivalent and is always 0 — use db.insert (RETURNING id) when the id is
// needed. RETURNING queries also come through here fine: rows carries them.
/**
 * Run the db subsystem operation.
 * @param opts.sql The SQL statement to execute.
 * @param opts.params Values bound to query placeholders.
 */
export default async function (ctx: Context, _session: Session | null, opts: { sql: string; params?: any }) {
    const query = async () => {
        const sql = await ctx.fns.procs.db.conn();
        const p = ctx.fns.procs.db.pgParams({ params: opts.params });
        const res: any = await sql.unsafe(ctx.fns.procs.db.toPg({ sql: opts.sql }), p);
        return { changes: Number(res?.count ?? res?.length ?? 0), lastInsertRowid: 0, rows: Array.from(res ?? []) };
    };
    const telemetry: any = (ctx.fns.procs as any).telemetry;
    const attrs = typeof telemetry?.dbAttrs === "function" ? telemetry.dbAttrs({ sql: opts.sql }) : {};
    return await (typeof telemetry?.safeSpan === "function" ? telemetry.safeSpan({ name: "db.query", attrs, fn: query }) : query());
}
