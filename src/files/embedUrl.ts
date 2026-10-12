/**
 * Resolves a file or directory to its embeddable Files UI address, local or on an SSH host.
 *
 * Use when a page frames the Files UI in an iframe (the file popup, the canvas): it resolves the path the
 * way every host-aware tool does (workspace.target), makes a relative remote path absolute on the host,
 * checks the file exists and returns the /files/embed/… (or /files/remote/embed/…) URL with the
 * initial tab. Throws "file not found" when the path does not exist.
 * @param opts.path Workspace-relative or absolute file or directory path.
 * @param opts.host SSH host alias the path lives on; omitted means the agent workspace (remote when it has a host).
 * @param opts.mode Initial file tab: auto lets the Files UI choose. @default auto
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Workspace-relative or absolute file or directory path. */
        path: string;
        /** SSH host alias the path lives on; omitted means the agent workspace (remote when it has a host). */
        host?: string;
        /** Initial file tab: auto lets the Files UI choose. @default auto */
        mode?: "auto" | "preview" | "source";
    },
): Promise<{ path: string; host: string | null; isDir: boolean; url: string }> {
    const at = ctx.fns.workspace.target({ host: opts.host, path: opts.path });
    const host = at.host ?? undefined;
    let path = host ? at.path : ctx.fns.files.resolveSafe({ path: opts.path });
    if (host && !path.startsWith("/")) {
        const q = ctx.fns.remote.quote({ value: path, path: true });
        const r = await ctx.fns.remote.exec({ host, command: 'f=' + q + '; [ -e "$f" ] || exit 2; if [ -d "$f" ]; then cd -- "$f" && pwd -P; else printf "%s/%s" "$(cd -- "$(dirname -- "$f")" && pwd -P)" "$(basename -- "$f")"; fi', timeout: 30 });
        if (r.exitCode !== 0) throw new Error(`file not found: ${host}:${opts.path}`);
        path = r.stdout.trim();
    }
    const info = await ctx.fns.files.stat({ path, host });
    if (!info) throw new Error(`file not found: ${host ? host + ":" : ""}${opts.path}`);
    const base = (await ctx.fns.files.browserUrl({ path, host })).replace("/files/absolute/", "/files/embed/").replace("/files/remote/", "/files/remote/embed/");
    const mode = opts.mode ?? "auto";
    const tab = mode === "preview" ? "preview" : mode === "source" ? "code" : "";
    return { path, host: host ?? null, isDir: info.isDir, url: tab ? `${base}?tab=${tab}` : base };
}
