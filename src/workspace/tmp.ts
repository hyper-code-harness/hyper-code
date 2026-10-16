import { dirname, isAbsolute, relative, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Returns the calling agent's private scratch path under .hyper/tmp/<agent-id>/
 *
 * Use this function to get an absolute local path for temporary data, drafts, dumps, backups, test markers or throwaway scripts that belong to the calling agent. The directory is <instance root>/.hyper/tmp/<agent-id>/, git-ignored and never scanned as code; calls without an agent use .hyper/tmp/shared/. Relative paths that escape the agent directory are rejected. The path is on this machine, not on an SSH workspace host.
 * @param opts.path File or directory path relative to the agent's scratch directory. @default "."
 * @param opts.mkdir Create the parent directory (or the directory itself when path is omitted) before returning. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** File or directory path relative to the agent's scratch directory. @default "." */
        path?: string;
        /** Create the parent directory (or the directory itself when path is omitted) before returning. @default true */
        mkdir?: boolean;
    },
): Promise<string> {
    const agentId = String(session?.agent?.id ?? session?.agentId ?? "shared");
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error("workspace.tmp: unsafe agent id");
    const base = resolve(ctx.fns.procs.project.projectRoot({}), ".hyper", "tmp", agentId);
    const target = resolve(base, opts.path || ".");
    const rel = relative(base, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("workspace.tmp: path escapes the agent scratch directory");
    if (opts.mkdir !== false) await mkdir(opts.path ? dirname(target) : target, { recursive: true });
    return target;
}
