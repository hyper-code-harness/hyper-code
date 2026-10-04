// What the pages cost on disk and how far back they go. The storage panel is
// the part of the dashboard that answers "is telemetry eating the machine".
import { readdir, stat } from "node:fs/promises";

/**
 * Report span storage occupancy across the open page, closed pages and parquet.
 *
 * Reads directory metadata only; it never opens a span file, so it stays cheap
 * even when the cold tier holds months of partitions.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<{
    openPage: { file: string; bytes: number } | null;
    pages: { count: number; bytes: number };
    cold: { partitions: number; files: number; bytes: number; oldest: string | null; newest: string | null };
    legacyBytes: number;
    totalBytes: number;
}> {
    const layout = await ctx.fns.telemetry.paths({});
    const current = String((ctx.state.procs as any)?.telemetry?.file ?? "");

    const openBytes = current ? await stat(current).then(s => s.size).catch(() => 0) : 0;
    const openPage = current ? { file: current.slice(current.lastIndexOf("/") + 1), bytes: openBytes } : null;

    const pageNames = (await readdir(layout.pages).catch(() => [] as string[])).filter(n => n.endsWith(".ndjson"));
    const pageSizes = await Promise.all(pageNames.map(n => stat(`${layout.pages}/${n}`).then(s => s.size).catch(() => 0)));

    const partitions = (await readdir(layout.cold).catch(() => [] as string[])).filter(n => n.startsWith("dt=")).sort();
    let files = 0;
    for (const partition of partitions) {
        files += (await readdir(`${layout.cold}/${partition}`).catch(() => [] as string[])).filter(n => n.endsWith(".parquet")).length;
    }
    const coldBytes = await ctx.fns.telemetry.dirBytes({ dir: layout.cold, pattern: "**/*.parquet" });
    // Before the first rotation the tracer is still appending to the legacy
    // file, so it is the open page — counting it in both tiers would double it.
    const legacySize = await stat(layout.legacy).then(s => s.size).catch(() => 0);
    const legacyBytes = current === layout.legacy ? 0 : legacySize;
    const pagesBytes = pageSizes.reduce((sum, n) => sum + n, 0);

    return {
        openPage,
        pages: { count: pageNames.length, bytes: pagesBytes },
        cold: {
            partitions: partitions.length, files, bytes: coldBytes,
            oldest: partitions[0]?.slice(3) ?? null,
            newest: partitions[partitions.length - 1]?.slice(3) ?? null,
        },
        legacyBytes,
        totalBytes: openBytes + pagesBytes + coldBytes + legacyBytes,
    };
}
