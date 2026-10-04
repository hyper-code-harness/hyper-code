// Where span pages live. One layout function so rotation, compaction, pruning
// and the dashboard never disagree about a directory name.
import { mkdir } from "node:fs/promises";

/**
 * Resolve the telemetry storage layout and create its directories.
 *
 * Three tiers: `open` holds the page currently being appended to, `pages` holds
 * closed immutable NDJSON awaiting compaction, `cold` holds hive-partitioned
 * parquet. `legacy` is the single unrotated file older installs wrote to.
 *
 * @param opts.ensure Create the directories when missing. @default true
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Create the directories when missing. @default true */
    ensure?: boolean;
}): Promise<{ root: string; open: string; pages: string; cold: string; legacy: string }> {
    const runtime = ctx.fns.procs.project.runtimeDir({});
    const root = `${runtime}/telemetry`;
    const layout = {
        root,
        open: `${root}/open`,
        pages: `${root}/pages`,
        cold: `${root}/cold`,
        legacy: `${runtime}/telemetry.ndjson`,
    };
    if (opts?.ensure !== false) {
        await Promise.all([layout.open, layout.pages, layout.cold].map(dir => mkdir(dir, { recursive: true })));
    }
    return layout;
}
