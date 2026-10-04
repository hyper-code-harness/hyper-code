/**
 * Executes one SQL statement on DuckDB and returns JSON-safe rows.
 *
 * Runs in this process through `@duckdb/node-api` — no subprocess, so a query
 * costs well under a millisecond and temporary tables, views, loaded extensions
 * and ATTACHed databases survive between calls. Falls back to the `duckdb` CLI
 * when the native module is not installed; the CLI path cannot see in-process
 * state and ignores `params`. Values are normalized for JSON: BigInt becomes a
 * number, dates become ISO strings. A timeout interrupts the query and leaves
 * the connection usable. This is the low-level primitive — prefer
 * `duckdb.query` unless you need writes.
 * @param opts.sql Single SQL statement to execute.
 * @param opts.params Values bound to `?` placeholders. Native engine only.
 * @param opts.db DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @param opts.timeout Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300
 * @returns The result rows, already converted to JSON-compatible values.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Single SQL statement to execute. */
        sql: string;
        /** Values bound to `?` placeholders. Native engine only. */
        params?: unknown[];
        /** DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database. */
        db?: string;
        /** Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300 */
        timeout?: number;
    },
): Promise<any[]> {
    const timeout = Math.max(1, Math.min(Number(opts.timeout ?? 30), 300));
    const { instance } = await ctx.fns.duckdb.conn({ db: opts.db });
    if (!instance) return await cli(ctx, opts, timeout);

    // A fresh connection per call: an interrupt cancels everything running on
    // its connection, so a timed-out query must not be able to kill a
    // concurrent one. The instance — and with it every ATTACH, extension and
    // table — is still shared.
    const connection = await instance.connect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interrupted = false;
    try {
        const query = Array.isArray(opts.params) && opts.params.length
            ? connection.runAndReadAll(opts.sql, opts.params)
            : connection.runAndReadAll(opts.sql);
        const timed = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                interrupted = true;
                try { connection.interrupt(); } catch { /* already finished */ }
                reject(new Error(`duckdb: query timed out after ${timeout}s`));
            }, timeout * 1000);
        });
        const result = await Promise.race([query, timed]);
        const rows = (result as any).getRowObjectsJS() as Record<string, unknown>[];
        return rows.map(row => ctx.fns.duckdb.normalize({ value: row })) as any[];
    } catch (error: any) {
        if (interrupted) throw new Error(`duckdb: query timed out after ${timeout}s`);
        throw new Error(`duckdb: ${error?.message ?? error}`);
    } finally {
        if (timer) clearTimeout(timer);
        try { connection.closeSync(); } catch { /* best effort */ }
    }
}

// The CLI is the compatibility path for a host without the native module. It
// starts a fresh database every time, so it only works for self-contained
// queries over files.
async function cli(ctx: Context, opts: { sql: string; db?: string; params?: unknown[] }, timeout: number): Promise<any[]> {
    if (Array.isArray(opts.params) && opts.params.length) throw new Error("duckdb: params require the native engine (@duckdb/node-api is not installed)");
    const bin = ctx.env.DUCKDB_BIN || "duckdb";
    const db = opts.db ? ctx.fns.workspace.resolve({ path: opts.db }) : ":memory:";
    const proc = Bun.spawn([bin, "-json", db, "-c", opts.sql], { stdout: "pipe", stderr: "pipe" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { try { proc.kill(9); } catch { /* already exited */ } reject(new Error(`duckdb: query timed out after ${timeout}s`)); }, timeout * 1000);
    });
    try {
        const [stdout, stderr, exitCode] = await Promise.race([
            Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
            timed,
        ]);
        if (exitCode !== 0) throw new Error(`duckdb exit ${exitCode}: ${stderr.trim() || stdout.trim()}`);
        const text = stdout.trim();
        return text ? JSON.parse(text) : [];
    } finally {
        if (timer) clearTimeout(timer);
    }
}
