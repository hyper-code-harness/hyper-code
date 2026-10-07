import { join } from "node:path";

/**
 * Maps a drawing name to its scene and preview file paths inside the drawings directory.
 *
 * Names are letters, digits, `-` and `_`; anything else
 * (dots, slashes, absolute paths) is rejected, so a name can never escape the directory.
 * @param opts.name Drawing name such as `butler`.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Drawing name: letters, digits, `-`, `_`; no extension. */
    name: string;
}): Promise<{ name: string; scene: string; svg: string }> {
    const name = String(opts.name ?? "").trim().replace(/\.excalidraw$/, "");
    if (!/^[A-Za-z0-9_-]+$/.test(name) || name.length > 120) throw new Error(`excalidraw: invalid drawing name "${opts.name}"`);
    const root = await ctx.fns.excalidraw.dir({});
    return { name, scene: join(root, `${name}.excalidraw`), svg: join(root, `${name}.svg`) };
}
