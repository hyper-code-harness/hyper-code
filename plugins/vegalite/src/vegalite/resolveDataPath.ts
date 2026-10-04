import { relative, resolve, isAbsolute } from "node:path";

/**
 * Resolves a chart data path to an absolute file inside the configured data root.
 *
 * The one place that answers "may this chart read this file". A path that
 * escapes the root with `..`, an absolute path outside it, or a non-local url
 * scheme is refused with a message naming what was asked for — charts come from
 * Markdown that nobody reviewed, so the answer must not depend on the caller.
 * Throws rather than returning a flag, so a forgotten check cannot read a file.
 * @param opts.path Data path from a spec url or a request, relative to the data root or absolute inside it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Data path from a spec url or a request, relative to the data root or absolute inside it. */
    path: string;
}): Promise<{ abs: string; rel: string; root: string }> {
    const raw = String(opts.path ?? "").trim();
    if (!raw) throw new Error("vegalite: empty data path");
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) throw new Error(`vegalite: not a local data path: ${raw}`);
    if (raw.includes("\0")) throw new Error("vegalite: data path contains a null byte");

    const root = await ctx.fns.vegalite.dataRoot({});
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    const rel = relative(root, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`vegalite: data path escapes the data root: ${raw} (root ${root})`);
    }
    return { abs, rel, root };
}
