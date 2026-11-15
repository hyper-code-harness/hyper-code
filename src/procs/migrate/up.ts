// Run pending migrations (collected from $migration_<id>.ts into ctx.state.
// migrations) in id order, recording each in the _migrations table. Idempotent:
// already-applied ids are skipped. Each migration's `up(ctx)` runs the change.
/**
 * Perform up for the migrate subsystem.
 * @param opts.only hyper-code2: run only these pending ids, leaving every other pending migration for its own moment (a plugin install runs the plugin's migrations, not a half-written one somebody is still editing).
 */
export default async function (ctx: Context, _session: Session | null, opts?: { /** hyper-code2: run only these pending ids. */ only?: string[] }) {
    await ctx.fns.procs.db.exec({ sql: "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)" });
    const applied = new Set((await ctx.fns.procs.db.select({ sql: "SELECT id FROM _migrations" })).map((r: any) => r.id));
    const migs = [...(ctx.state.procs?.migrate?.list ?? [])].sort((a, b) => a.id.localeCompare(b.id));

    const ran: string[] = [];
    const only = opts?.only ? new Set(opts.only) : null; // hyper-code2
    for (const m of migs) {
        if (applied.has(m.id)) continue;
        if (only && !only.has(m.id)) continue;
        await m.up(ctx);
        await ctx.fns.procs.db.run({ sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", params: [m.id, new Date().toISOString()] });
        ctx.fns.procs.log.info({ event: "migrate.up", msg: m.id });
        ran.push(m.id);
    }
    return { applied: ran };
}
