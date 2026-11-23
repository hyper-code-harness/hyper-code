// Run a SELECT → rows.  (A function is a verb: `db.select`, not `db.query` —
// which also keeps the name free for the type `db/Query.ts`.) params: array,
// bound positionally. `?` placeholders are translated to Postgres $1..$n by
// db.toPg, so call sites keep the portable `?` style.
/**
 * Select the db subsystem operation.
 * @param opts.sql The SQL statement to execute.
 * @param opts.params Values bound to query placeholders.
 */
export default async function (ctx: Context, _session: Session | null, opts: { sql: string; params?: any }): Promise<any[]> {
    const query = async () => {
        const sql = await ctx.fns.procs.db.conn();
        const p = ctx.fns.procs.db.pgParams({ params: opts.params });
        const rows = await sql.unsafe(ctx.fns.procs.db.toPg({ sql: opts.sql }), p);
        return Array.from(rows);
    };

    // hyper-code2: tracing is OPTIONAL here. Reading it off ctx.fns directly
    // made every query — and therefore the whole process, including the REPL
    // used to fix things — fail the moment the telemetry module was absent or
    // not yet loaded. Observability must never be able to take down the thing
    // it observes.
    const telemetry: any = (ctx.fns.procs as any).telemetry;
    if (typeof telemetry?.span !== "function") return await query();
    const attrs = typeof telemetry.dbAttrs === "function" ? telemetry.dbAttrs({ sql: opts.sql }) : {};
    return await telemetry.span({ name: "db.query", attrs, fn: query });
}
