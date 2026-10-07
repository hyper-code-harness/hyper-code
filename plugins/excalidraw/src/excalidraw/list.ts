/**
 * Lists saved Excalidraw drawings with their size, update time and whether a preview SVG exists.
 *
 * Use to find a drawing to open, show or read.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {} = {}): Promise<Array<{ name: string; url: string; updatedAt: number; bytes: number; preview: boolean }>> {
    const root = await ctx.fns.excalidraw.dir({});
    const { stat } = await import("node:fs/promises");
    const out: Array<{ name: string; url: string; updatedAt: number; bytes: number; preview: boolean }> = [];
    try {
        for await (const rel of new Bun.Glob("*.excalidraw").scan({ cwd: root })) {
            const name = rel.replace(/\.excalidraw$/, "");
            const st = await stat(`${root}/${rel}`);
            out.push({ name, url: `/excalidraw/${name}`, updatedAt: st.mtimeMs, bytes: st.size, preview: await Bun.file(`${root}/${name}.svg`).exists() });
        }
    } catch (e: any) {
        if (e?.code !== "ENOENT") throw e;
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
