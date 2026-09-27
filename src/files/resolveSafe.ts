import { resolve } from "node:path";

// Resolve `path` to an absolute path against the workspace root (cwd).
// Relative paths resolve under cwd; absolute paths pass through unchanged;
// empty path == cwd.
//
// NOTE: the previous workspace-confinement guard (it threw "outside workspace"
// for any path that escaped cwd) was removed by request — files.* may now read
// and write anywhere the process has permission, including ../ siblings and
// absolute paths like /tmp or /Users/.../.claude. This deliberately
// de-sandboxes the agent's file tools; only run agents you trust on this build.
/** Resolves a path while preventing workspace traversal. */
export default function (_ctx: Context, session: Session | null, opts: { /** Workspace-relative path. */ path: string }): string {
    // A remote workspace (workspaceHost set) is not a local directory.
    const base = session?.agent?.workspaceHost ? process.cwd() : (session?.agent?.workspaceDir ?? process.cwd());
    return resolve(base, opts.path || ".");
}
