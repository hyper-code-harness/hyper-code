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
/**
 * Resolves a workspace-relative path to an absolute one; does NOT confine it to the workspace.
 *
 * Relative paths resolve against the agent's workspace directory, absolute paths pass through unchanged, and an empty path means the workspace itself. The name is historical: the confinement check this function used to perform was removed deliberately, so `../` and absolute paths DO escape the workspace and the result must not be treated as validated. A caller that needs a path to stay inside the workspace has to check that itself.
 * @param opts.path Path to resolve, relative to the workspace or absolute.
 */
export default function (_ctx: Context, session: Session | null, opts: { /** Workspace-relative path. */ path: string }): string {
    // A remote workspace (workspaceHost set) is not a local directory.
    const base = session?.agent?.workspaceHost ? process.cwd() : (session?.agent?.workspaceDir ?? process.cwd());
    return resolve(base, opts.path || ".");
}
