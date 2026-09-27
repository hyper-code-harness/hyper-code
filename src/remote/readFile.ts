/**
 * Reads a UTF-8 text file from a remote SSH server.
 *
 * Fetches the whole file over the persistent remote.exec connection. Relative paths resolve against the remote home; ~/ is supported. Refuses files over 10 MB. Used by files.read and host-aware tools when a `host` is given.
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers).
 * @param opts.path Remote file path; relative to the remote home, ~/ allowed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config (see remote.servers). */
        host: string;
        /** Remote file path; relative to the remote home, ~/ allowed. */
        path: string;
    },
): Promise<string> {
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const rp = ctx.fns.remote.quote({ value: opts.path, path: true });
    const r = await ctx.fns.remote.exec({ host: opts.host, command: "f=" + rp + "; [ -f \"$f\" ] || { echo \"not a file: $f\" >&2; exit 2; }; s=$(wc -c < \"$f\"); [ $s -le 10485760 ] || { echo \"File too large: $s bytes\" >&2; exit 3; }; cat -- \"$f\"" });
    if (r.exitCode !== 0) throw new Error(`${opts.host}:${opts.path}: ${(r.stderr || "exit " + r.exitCode).trim()}`);
    return r.stdout;
}
