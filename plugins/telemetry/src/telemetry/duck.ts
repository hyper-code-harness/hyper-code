// The one place that spawns DuckDB. Telemetry must never be able to take down
// the process it observes, so the caller gets an error object rather than an
// exception when the binary is missing.
/**
 * Execute read-only DuckDB SQL over span storage and return parsed JSON rows.
 *
 * Runs the DuckDB CLI configured for this plugin. A missing binary, a non-zero
 * exit or a timeout is reported as `{ ok: false, error }` instead of throwing,
 * so a dashboard renders a diagnosis rather than a stack trace.
 *
 * @param opts.sql DuckDB SQL to execute; the final statement produces the rows.
 * @param opts.timeout Seconds before the process is killed. @minimum 1 @maximum 600
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** DuckDB SQL to execute; the final statement produces the rows. */
    sql: string;
    /** Seconds before the process is killed. @minimum 1 @maximum 600 */
    timeout?: number;
}): Promise<{ ok: true; rows: any[] } | { ok: false; error: string; rows: [] }> {
    const config = ctx.fns.procs.config.resolve({ module: "telemetry" }) as ConfigOf<typeof import("./$config").default>;
    const seconds = Math.max(1, Math.min(Number(opts.timeout ?? config.duckdbTimeout), 600));
    let proc: ReturnType<typeof Bun.spawn>;
    try {
        proc = Bun.spawn([config.duckdbBin, "-json", ":memory:", "-c", opts.sql], { stdout: "pipe", stderr: "pipe" });
    } catch (error: any) {
        return { ok: false, error: `duckdb not available (${config.duckdbBin}): ${String(error?.message ?? error)}`, rows: [] };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timed = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { try { proc.kill(9); } catch { /* already gone */ } reject(new Error(`duckdb timed out after ${seconds}s`)); }, seconds * 1000);
        });
        const [stdout, stderr, code] = await Promise.race([
            Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text(), proc.exited]),
            timed,
        ]);
        if (code !== 0) return { ok: false, error: `duckdb exit ${code}: ${(stderr || stdout).trim().slice(0, 1000)}`, rows: [] };
        const text = stdout.trim();
        return { ok: true, rows: text ? JSON.parse(text) : [] };
    } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error), rows: [] };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
