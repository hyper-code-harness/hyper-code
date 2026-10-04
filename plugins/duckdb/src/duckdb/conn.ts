// One DuckDB instance per database per ctx, cached in ctx.state.duckdb. The
// instance owns the database, so ATTACHed databases, installed extensions and
// created tables outlive a single call and are shared by every connection taken
// from it. A forked ctx (tests) gets its own instances and cannot see another
// world's attachments.
//
// `null` means the native module is not installed — duckdb.run then falls back
// to the DuckDB CLI, which is why this reports instead of throwing.

/**
 * Opens the shared in-process DuckDB instance for a database, or reports that the native engine is missing.
 *
 * The instance is created once per database per runtime context and reused:
 * queries run in this process with no subprocess, and ATTACHed databases,
 * loaded extensions and created tables persist between calls. Returns a `null`
 * instance with a reason when `@duckdb/node-api` is not installed, which tells
 * `duckdb.run` to use the CLI instead. Use when writing a function that needs
 * the raw connection API; ordinary queries belong in `duckdb.query`.
 * @param opts.db DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @returns The native instance, or null with the reason the native engine is unavailable.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database. */
    db?: string;
}): Promise<{ instance: any | null; reason?: string }> {
    const state = ((ctx.state as any).duckdb ??= {});
    const key = opts?.db ? ctx.fns.workspace.resolve({ path: opts.db }) : ":memory:";
    const instances: Map<string, any> = (state.instances ??= new Map());
    const existing = instances.get(key);
    if (existing) return { instance: existing };
    if (state.unavailable) return { instance: null, reason: state.unavailable };

    let api: any;
    try {
        api = await import("@duckdb/node-api");
    } catch (error: any) {
        state.unavailable = `@duckdb/node-api is not installed (${error?.message ?? error})`;
        return { instance: null, reason: state.unavailable };
    }

    const config: Record<string, string> = {};
    const memoryLimit = await ctx.fns.settings.getString({ module: "duckdb", scopeType: "global", key: "memoryLimit", fallback: "" });
    const threads = await ctx.fns.settings.getNumber({ module: "duckdb", scopeType: "global", key: "threads", fallback: 0 });
    if (String(memoryLimit ?? "").trim()) config.memory_limit = String(memoryLimit).trim();
    if (Number(threads) > 0) config.threads = String(Math.floor(Number(threads)));

    const instance = await api.DuckDBInstance.create(key, config);
    instances.set(key, instance);
    return { instance };
}
