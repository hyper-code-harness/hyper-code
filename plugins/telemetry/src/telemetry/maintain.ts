// One maintenance pass: rotate what is full, compact what is closed, prune what
// is expired. Called on a timer by $start and by hand from the dashboard.
/**
 * Run one storage maintenance pass over span pages.
 *
 * Safe to call at any time and from any number of callers: each step is
 * individually idempotent, and a failure in one step never prevents the others
 * from running.
 *
 * @param opts.force Rotate the open page even when it is neither full nor stale. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Rotate the open page even when it is neither full nor stale. @default false */
    force?: boolean;
}): Promise<{
    rotated: boolean;
    compacted: number;
    bytesIn: number;
    bytesOut: number;
    pruned: number;
    errors: string[];
}> {
    const errors: string[] = [];
    let rotated = false;
    let compacted = 0;
    let bytesIn = 0;
    let bytesOut = 0;
    let pruned = 0;

    try {
        rotated = (await ctx.fns.telemetry.rotate({ force: opts?.force })).rotated;
    } catch (error: any) { errors.push(`rotate: ${String(error?.message ?? error)}`); }

    try {
        const result = await ctx.fns.telemetry.compact({});
        compacted = result.converted;
        bytesIn = result.bytesIn;
        bytesOut = result.bytesOut;
        for (const failure of result.failed) errors.push(`compact ${failure.page}: ${failure.error}`);
    } catch (error: any) { errors.push(`compact: ${String(error?.message ?? error)}`); }

    try {
        pruned = (await ctx.fns.telemetry.prune({})).removed.length;
    } catch (error: any) { errors.push(`prune: ${String(error?.message ?? error)}`); }

    if (compacted || pruned) {
        ctx.fns.procs.log.info({ event: "telemetry.maintained", msg: `compacted ${compacted} page(s), pruned ${pruned}`, compacted, pruned, bytesIn, bytesOut });
    }
    return { rotated, compacted, bytesIn, bytesOut, pruned, errors };
}
