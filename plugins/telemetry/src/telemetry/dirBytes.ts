// Disk accounting for the storage panel: how much a tier costs, without
// shelling out to du and without walking anything the caller did not ask for.
import { glob, stat } from "node:fs/promises";

/**
 * Sum the size of files under a directory tree.
 *
 * @param opts.dir Directory to walk recursively.
 * @param opts.match Only count files whose base name contains this text.
 * @param opts.pattern Glob suffix appended to the directory. @default "**\/*"
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Directory to walk recursively. */
    dir: string;
    /** Only count files whose base name contains this text. */
    match?: string;
    /** Glob suffix appended to the directory. @default "**\/*" */
    pattern?: string;
}): Promise<number> {
    let total = 0;
    try {
        for await (const entry of glob(`${opts.dir}/${opts.pattern ?? "**/*"}`)) {
            const name = String(entry).slice(String(entry).lastIndexOf("/") + 1);
            if (opts.match && !name.includes(opts.match)) continue;
            const info = await stat(entry).catch(() => null);
            if (info?.isFile()) total += info.size;
        }
    } catch { /* a tier that does not exist yet costs nothing */ }
    return total;
}
