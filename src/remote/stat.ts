/**
 * Returns metadata for a path on an SSH server, or null when it does not exist.
 *
 * Follows symlinks. Works with GNU (Linux) and BSD (macOS) stat. Used by
 * files.stat and the Files UI for remote paths.
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers).
 * @param opts.path Remote path; relative to the remote home, ~/ allowed.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config (see remote.servers). */
        host: string;
        /** Remote path; relative to the remote home, ~/ allowed. */
        path: string;
    },
): Promise<{ isDir: boolean; size: number; mtime: number } | null> {
    const p = ctx.fns.remote.quote({ value: opts.path || "~", path: true });
    const script = "f=" + p + "; [ -e \"$f\" ] || { echo MISSING; exit 0; }; "
        + "{ stat -L -c '%F|%s|%Y' -- \"$f\" 2>/dev/null || stat -L -f '%HT|%z|%m' -- \"$f\"; }";
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: 30 });
    if (r.exitCode !== 0) throw new Error(`${opts.host}:${opts.path}: ${(r.stderr || "exit " + r.exitCode).trim()}`);
    const line = r.stdout.trim();
    if (line === "MISSING" || !line) return null;
    const [kind, size, mtime] = line.split("|");
    return { isDir: /directory/i.test(kind ?? ""), size: Number(size) || 0, mtime: (Number(mtime) || 0) * 1000 };
}
