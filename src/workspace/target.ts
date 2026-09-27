/**
 * Resolves where a tool call acts: which host (null = local) and which path there.
 *
 * The single rule every host-aware tool follows:
 * - explicit host "local" → local, path against the local workspace (or the server cwd when the workspace is remote);
 * - explicit host (any other alias) → that host; relative paths stay relative to its home, unless it is the
 *   agent's workspace host, then they resolve against the workspace directory;
 * - no host → the agent's workspace host if it has one (paths against workspaceDir), else local.
 * ~ and absolute paths are returned unchanged. Use it in tools instead of reading agent.workspaceHost directly.
 * @param opts.host Host requested by the caller: an alias, "local", or omitted for the workspace default.
 * @param opts.path Path requested by the caller; omitted means the workspace directory itself.
 */
export default function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Host requested by the caller: an alias, "local", or omitted for the workspace default. */
        host?: string;
        /** Path requested by the caller; omitted means the workspace directory itself. */
        path?: string;
    },
): { host: string | null; path: string; dir: string } {
    const wsHost = String(session?.agent?.workspaceHost ?? "").trim();
    const wsDir = session?.agent?.workspaceDir || "";
    const asked = String(opts.host ?? "").trim();
    const p = opts.path ?? "";

    if (asked === "local" || (!asked && !wsHost)) {
        const dir = wsHost ? process.cwd() : (wsDir || process.cwd());
        return { host: null, path: ctx.fns.workspace.resolve({ path: p, base: dir }), dir };
    }
    const host = asked || wsHost;
    // Relative paths on the workspace host resolve against the workspace dir;
    // on any other host they stay relative (the remote home).
    const base = host === wsHost ? wsDir : "";
    const joined = !p ? (base || "~")
        : p.startsWith("/") || p === "~" || p.startsWith("~/") ? p
        : base ? base.replace(/\/+$/, "") + "/" + p.replace(/^\.\//, "")
        : p;
    return { host, path: joined, dir: base || "~" };
}
