/**
 * Draws a reference to a file: its type icon, name and folder; a click opens it on the canvas.
 * @param opts.path File path.
 * @param opts.host SSH host alias, when the file is remote.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** File path. */
    path: string;
    /** SSH host alias, when the file is remote. */
    host?: string;
}): string {
    const name = String(opts.path).split("/").filter(Boolean).pop() ?? opts.path;
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    const icon = /^(png|jpe?g|gif|webp|svg)$/.test(ext) ? "image" : /^(md|txt)$/.test(ext) ? "file-text" : /^(ts|js|tsx|json|css|html|py|sh)$/.test(ext) ? "file-code" : ext === "pdf" ? "file-pdf" : "file";
    const folder = String(opts.path).split("/").slice(0, -1).join("/");
    const url = `/rpc/files.page?${encodeURIComponent(JSON.stringify({ path: opts.path, ...(opts.host ? { host: opts.host } : {}) }))}`;
    return ctx.fns.w.listRow({ label: name, detail: (opts.host ? opts.host + ":" : "") + folder, icon, action: { href: url } });
}
