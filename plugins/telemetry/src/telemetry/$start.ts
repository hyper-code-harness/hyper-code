// Take over the tracer's sink and keep it paged. The built-in tracer starts
// first and writes to one file; from here on it writes to a page we rotate.
/**
 * Start telemetry storage maintenance.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const config = ctx.fns.procs.config.resolve({ module: "telemetry" }) as ConfigOf<typeof import("./$config").default>;
    const every = Math.max(30_000, Number(config.maintainMs));

    // Adopt an unrotated legacy file and open the first page immediately, so a
    // long-running process does not keep appending to .runtime/telemetry.ndjson.
    const first = await ctx.fns.telemetry.maintain({}).catch((error: any) => {
        ctx.fns.procs.log.warn({ event: "telemetry.maintain.failed", msg: String(error?.message ?? error) });
        return null;
    });

    const timer = setInterval(() => {
        void ctx.fns.telemetry.maintain({}).catch((error: any) =>
            ctx.fns.procs.log.warn({ event: "telemetry.maintain.failed", msg: String(error?.message ?? error) }));
    }, every);
    timer.unref?.();

    ctx.fns.procs.log.info({ event: "telemetry.storage.started", msg: `paging every ${Math.round(every / 1000)}s`, compacted: first?.compacted ?? 0 });
    return { timer, maintainMs: every };
}
