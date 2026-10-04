// Close the open page and start a new one. A closed page is immutable: nothing
// appends to it again, so compaction and deletion need no locking.
import { rename, stat, readdir } from "node:fs/promises";

/**
 * Rotate the open span page when it is full, stale or forced.
 *
 * Adopts the legacy single-file sink on first run by moving it into the closed
 * pages directory, so an install that has been writing one large NDJSON file
 * starts paging without losing history.
 *
 * @param opts.force Close the open page regardless of size and age. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Close the open page regardless of size and age. @default false */
    force?: boolean;
}): Promise<{ rotated: boolean; closed: string | null; open: string; bytes: number }> {
    const config = ctx.fns.procs.config.resolve({ module: "telemetry" }) as ConfigOf<typeof import("./$config").default>;
    const layout = await ctx.fns.telemetry.paths({});
    const current = String((ctx.state.procs as any)?.telemetry?.file ?? "");

    // An install that predates paging writes one file directly in .runtime.
    // Adopt it as a closed page instead of leaving it to grow forever.
    if (!current.startsWith(layout.open + "/")) {
        const fresh = `${layout.open}/${ctx.fns.telemetry.pageName({})}`;
        await ctx.fns.procs.telemetry.useFile({ file: fresh });
        if (current) {
            const size = await stat(current).then(s => s.size).catch(() => 0);
            if (size > 0) {
                const adopted = `${layout.pages}/${ctx.fns.telemetry.pageName({ now: Date.now() - 1000 })}`;
                await rename(current, adopted).catch(() => undefined);
                return { rotated: true, closed: adopted, open: fresh, bytes: size };
            }
        }
        return { rotated: true, closed: null, open: fresh, bytes: 0 };
    }

    const info = await stat(current).catch(() => null);
    const bytes = info?.size ?? 0;
    const opened = info?.birthtimeMs || info?.mtimeMs || Date.now();
    const sameDay = new Date(opened).toDateString() === new Date().toDateString();
    const full = bytes >= Math.max(1024, config.pageBytes);
    const stale = config.pageByDay && !sameDay && bytes > 0;
    if (!opts?.force && !full && !stale) return { rotated: false, closed: null, open: current, bytes };
    if (bytes === 0) return { rotated: false, closed: null, open: current, bytes };

    const fresh = `${layout.open}/${ctx.fns.telemetry.pageName({})}`;
    await ctx.fns.procs.telemetry.useFile({ file: fresh });
    const name = current.slice(current.lastIndexOf("/") + 1);
    const taken = new Set(await readdir(layout.pages).catch(() => [] as string[]));
    const target = `${layout.pages}/${taken.has(name) ? `${Date.now()}-${name}` : name}`;
    await rename(current, target);
    return { rotated: true, closed: target, open: fresh, bytes };
}
