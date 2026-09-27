import { resolve } from "node:path";
import { mkdir, stat } from "node:fs/promises";

/**
 * Validates a workspace directory and returns its absolute path, locally or on an SSH host.
 *
 * Without host the directory is resolved against the server's cwd and must
 * exist locally. With host it is resolved on that machine (relative paths and
 * ~ against the remote home) and returned as the absolute remote path, so a
 * stored workspace never depends on the remote shell's expansion later.
 * @param opts.dir Directory to use; relative paths resolve against the server cwd, or the remote home with host.
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers); empty or omitted means local.
 * @param opts.create Create the directory when it does not exist. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Directory to use; relative paths resolve against the server cwd, or the remote home with host. */
        dir?: string;
        /** SSH host alias from ~/.ssh/config (see remote.servers); empty or omitted means local. */
        host?: string;
        /** Create the directory when it does not exist. @default false */
        create?: boolean;
    },
): Promise<string> {
    const host = String(opts.host ?? "").trim();
    if (host) {
        const raw = opts.dir?.trim() || "~";
        const q = ctx.fns.remote.quote({ value: raw, path: true });
        const r = await ctx.fns.remote.exec({
            host,
            command: (opts.create ? "mkdir -p -- " + q + " && " : "") + "cd -- " + q + " 2>/dev/null && pwd -P || { printf 'workspace directory not found: %s\\n' " + ctx.fns.remote.quote({ value: raw }) + " >&2; exit 2; }",
            timeout: 30,
        });
        if (r.exitCode !== 0) throw new Error(`${host}: ${(r.stderr || "exit " + r.exitCode).trim()}`);
        return r.stdout.trim();
    }
    const dir = resolve(opts.dir?.trim() || process.cwd());
    let info = await stat(dir).catch(() => null);
    if (!info && opts.create) {
        await mkdir(dir, { recursive: true });
        info = await stat(dir);
    }
    if (!info?.isDirectory()) throw new Error(`workspace directory not found: ${dir}`);
    return dir;
}
