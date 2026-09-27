/**
 * Syncs files or directories between the local machine and an SSH server with rsync, in either direction.
 *
 * Incremental, compressed rsync over the shared persistent SSH connection (same ControlMaster socket as remote.exec); only changed files are sent and missing destination parent directories are created (works with GNU rsync and macOS openrsync). direction "push" copies local → remote (deploy code, configs, data); "pull" copies remote → local (logs, build artifacts, screenshots). Use remote.writeFile / remote.readFile for a single text file.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.direction push = local → remote, pull = remote → local.
 * @param opts.local Local path, relative to the workspace or absolute. A trailing slash on a source directory copies its contents rather than the directory itself.
 * @param opts.remote Remote path (destination for push, source for pull); relative to the remote home, ~/ allowed.
 * @param opts.exclude rsync --exclude patterns, e.g. node_modules or .git.
 * @param opts.delete Delete destination files missing from the source (mirror). @default false
 * @param opts.dryRun Report what would transfer without copying. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** push = local → remote, pull = remote → local. */
        direction: "push" | "pull";
        /** Local path, relative to the workspace or absolute. A trailing slash on a source directory copies its contents rather than the directory itself. */
        local: string;
        /** Remote path (destination for push, source for pull); relative to the remote home, ~/ allowed. */
        remote: string;
        /** rsync --exclude patterns, e.g. node_modules or .git. */
        exclude?: string[];
        /** Delete destination files missing from the source (mirror). @default false */
        delete?: boolean;
        /** Report what would transfer without copying. @default false */
        dryRun?: boolean;
    },
): Promise<{ files: number; bytes: number; ms: number; dryRun: boolean; direction: "push" | "pull" }> {
    if (!/^[A-Za-z0-9._@-]+$/.test(opts.host)) throw new Error("invalid host: " + opts.host);
    const local = ctx.fns.workspace.resolve({ path: opts.local }) + (opts.local.endsWith("/") ? "/" : "");
    const shq0 = (s: string) => /^[A-Za-z0-9_./=%:@-]+$/.test(s) ? s : ctx.fns.remote.quote({ value: s });
    const ssh = ["ssh", "-T", ...(await ctx.fns.remote.sshOptions({})).args].map(shq0).join(" ");
    const args = ["rsync", "-az", "--stats", "-e", ssh];
    if (opts.delete) args.push("--delete");
    if (opts.dryRun) args.push("--dry-run");
    for (const e of opts.exclude ?? []) args.push("--exclude", e);
    const remote = opts.host + ":" + opts.remote;
    if (opts.direction !== "push" && opts.direction !== "pull") throw new Error("direction must be push or pull");
    // macOS ships openrsync without --mkpath: create the destination's parent first.
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    if (opts.direction === "push") {
        const dest = opts.remote.endsWith("/") ? opts.remote : opts.remote.replace(/\/[^/]*$/, "") || ".";
        const q = ctx.fns.remote.quote({ value: dest, path: true });
        await ctx.fns.remote.exec({ host: opts.host, command: "mkdir -p " + q, timeout: 30 });
    } else if (!opts.dryRun) {
        await mkdir(opts.local.endsWith("/") ? local : dirname(local), { recursive: true });
    }
    args.push(...(opts.direction === "push" ? [local, remote] : [remote, local]));
    const started = Date.now();
    const p = Bun.spawn({ cmd: args, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) throw new Error("rsync exit " + code + ": " + err.trim().slice(0, 800));
    const num = (re: RegExp) => Number((re.exec(out)?.[1] ?? "0").replaceAll(",", ""));
    return { files: num(/Number of (?:regular )?files transferred: ([\d,]+)/), bytes: num(/Total transferred file size: ([\d,]+)/), ms: Date.now() - started, dryRun: !!opts.dryRun, direction: opts.direction };
}
