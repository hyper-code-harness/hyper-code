// Retention. Disk is the one resource telemetry can exhaust on its own: this
// install had grown an 11 GB unrotated span file before paging existed.
import { readdir, rm } from "node:fs/promises";

/**
 * Delete cold parquet partitions older than the configured retention.
 *
 * Partitions are hive directories named `dt=YYYY-MM-DD`, so expiry is a name
 * comparison and never opens a file.
 *
 * @param opts.days Days of parquet to keep; defaults to the configured retention, 0 keeps everything. @minimum 0
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Days of parquet to keep; 0 keeps everything. @minimum 0 */
    days?: number;
}): Promise<{ removed: string[]; kept: number }> {
    const config = ctx.fns.procs.config.resolve({ module: "telemetry" }) as ConfigOf<typeof import("./$config").default>;
    const days = Math.max(0, Number(opts?.days ?? config.coldRetentionDays));
    const layout = await ctx.fns.telemetry.paths({});
    const partitions = (await readdir(layout.cold).catch(() => [] as string[])).filter(name => name.startsWith("dt="));
    if (!days) return { removed: [], kept: partitions.length };

    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const removed: string[] = [];
    for (const name of partitions) {
        if (name.slice(3) >= cutoff) continue;
        await rm(`${layout.cold}/${name}`, { recursive: true, force: true }).catch(() => undefined);
        removed.push(name);
    }
    if (removed.length) ctx.fns.procs.log.info({ event: "telemetry.pruned", msg: `${removed.length} partitions older than ${cutoff}`, days });
    return { removed, kept: partitions.length - removed.length };
}
