/**
 * Shows a file or directory in the Files viewer as a page: breadcrumbs, a listing, or a file with Preview / Code /
 * Edit.
 *
 * Use for an address of a file: `/rpc/files.page?{"path":"/abs/README.md"}` — on the canvas a view tab (what a
 * `file` tab is), in a chat link, or in a browser tab. Same viewer and the same access as the /files page; a
 * private path (files.isPrivateResult) shows as not found. Links inside are the Files addresses; a canvas tab
 * moves itself along them.
 * @view
 * @param opts.path Absolute path of the file or directory.
 * @param opts.host SSH host alias the path lives on; omit or "local" for this machine.
 * @param opts.tab File tab to show; empty picks Preview for Markdown/HTML/media and Code otherwise. @default ""
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path of the file or directory. */
    path: string;
    /** SSH host alias the path lives on; omit or "local" for this machine. */
    host?: string;
    /** File tab to show; empty picks Preview for Markdown/HTML/media and Code otherwise. @default "" */
    tab?: "" | "preview" | "code" | "edit";
}): Promise<string> {
    const path = String(opts.path ?? "").trim();
    if (!path) throw new Error("files.page: path is required");
    const host = opts.host && opts.host !== "local" ? String(opts.host) : undefined;
    const info = await ctx.fns.files.stat({ path, host });
    if (!info || (await ctx.fns.files.isPrivateResult({ path, host }))) throw new Error(`file not found: ${host ? host + ":" : ""}${path}`);
    const tab = (["preview", "code", "edit"].includes(String(opts.tab)) ? opts.tab : "") as "" | "preview" | "code" | "edit";
    const view = await ctx.fns.files.view({ path, host, isDir: info.isDir, tab, wide: true, assetsBase: true });
    return `<div data-canvas-files>${view.html}</div>`;
}
