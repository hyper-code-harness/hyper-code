/**
 * Builds the canonical path-based Files UI URL for a filesystem path, local or on an SSH host.
 *
 * Use when linking a file or directory into the browser-facing Files UI. It resolves relative paths and encodes each absolute path segment while preserving slash separators, allowing browser-relative Markdown and HTML resources to resolve correctly. With host the URL is /files/remote/<host>/<absolute path>; relative remote paths are not resolved (pass absolute ones, as stored in a remote workspace).
 * @param opts.path Relative or absolute filesystem path to expose through the Files UI.
 * @param opts.host SSH host alias the path lives on; omitted means local.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Relative or absolute filesystem path to expose through the Files UI. */
        path: string;
        /** SSH host alias the path lives on; omitted means local. */
        host?: string;
    },
): Promise<string> {
    if (opts.host) {
        const encoded = opts.path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
        return `/files/remote/${encodeURIComponent(opts.host)}/` + encoded;
    }
    const absolute = ctx.fns.files.resolveSafe({ path: opts.path });
    const encoded = absolute.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    return "/files/absolute/" + encoded;
}
