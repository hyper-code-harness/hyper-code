// CREATE EXTENSION is the half of the setup that a migration can own. The
// other half — listing the library in shared_preload_libraries — can only
// happen at server start and lives in docker-compose.yml, so this migration
// never fails a boot when the library is absent: the dashboard says so instead.
export default {
    /**
     * Create the pg_stat_statements extension when the server can load it.
     *
     * @param ctx - Runtime context used to run SQL.
     */
    async up(ctx: Context) {
        try {
            await ctx.fns.procs.db.run({ sql: "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" });
        } catch (error: any) {
            // Not preloaded, or no permission to create extensions. Either way
            // this is a diagnostic nicety, not a schema the app depends on.
            ctx.fns.procs.log.warn({
                event: "telemetry.pg_stat_statements.unavailable",
                msg: `${String(error?.message ?? error).slice(0, 200)} — add pg_stat_statements to shared_preload_libraries (see docker-compose.yml)`,
            });
        }
    },

    /**
     * Drop the extension again.
     *
     * @param ctx - Runtime context used to run SQL.
     */
    async down(ctx: Context) {
        await ctx.fns.procs.db.run({ sql: "DROP EXTENSION IF EXISTS pg_stat_statements" }).catch(() => undefined);
    },
};
