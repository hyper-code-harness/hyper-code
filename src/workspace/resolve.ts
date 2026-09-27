import { resolve } from "node:path";

/**
 * Resolves a path against the local workspace directory.
 *
 * Always a LOCAL path: when the agent's workspace is on an SSH host, relative
 * paths resolve against the server's cwd instead (the remote directory does
 * not exist here). For host-aware resolution use workspace.target.
 * @param opts.path Workspace-relative or absolute path. @default "."
 * @param opts.base Directory to resolve against instead of the workspace.
 */
export default function (
    _ctx: Context,
    session: Session | null,
    opts: {
        /** Workspace-relative or absolute path. @default "." */
        path?: string;
        /** Directory to resolve against instead of the workspace. */
        base?: string;
    },
): string {
    const remote = !!String(session?.agent?.workspaceHost ?? "").trim();
    const base = opts.base ?? (remote ? process.cwd() : (session?.agent?.workspaceDir ?? process.cwd()));
    return resolve(base, opts.path || ".");
}
