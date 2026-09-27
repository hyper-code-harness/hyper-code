/**
 * Reads a remote file as raw bytes over SSH, for images, PDFs and other binary content.
 *
 * Streams `cat` output of the persistent remote.exec connection without UTF-8
 * decoding. Refuses files larger than maxBytes. Use remote.readFile for text.
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers).
 * @param opts.path Remote file path; relative to the remote home, ~/ allowed.
 * @param opts.maxBytes Largest file accepted. @default 52428800 @minimum 1
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config (see remote.servers). */
        host: string;
        /** Remote file path; relative to the remote home, ~/ allowed. */
        path: string;
        /** Largest file accepted. @default 52428800 @minimum 1 */
        maxBytes?: number;
    },
): Promise<Uint8Array> {
    if (!/^[A-Za-z0-9._@-]+$/.test(opts.host)) throw new Error("invalid host: " + opts.host);
    const max = Math.max(1, opts.maxBytes ?? 50 * 1024 * 1024);
    const p = ctx.fns.remote.quote({ value: opts.path, path: true });
    const script = "f=" + p + "; [ -f \"$f\" ] || { printf 'not a file: %s\\n' \"$f\" >&2; exit 2; }; "
        + "s=$(wc -c < \"$f\"); [ \"$s\" -le " + max + " ] || { echo \"file too large: $s bytes\" >&2; exit 3; }; cat -- \"$f\"";
    const ssh = await ctx.fns.remote.sshOptions({});
    const proc = Bun.spawn({
        cmd: ["ssh", "-T", ...ssh.args, opts.host, "bash -lc " + ctx.fns.remote.quote({ value: script })],
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 120_000);
    try {
        const [bytes, err, code] = await Promise.all([
            new Response(proc.stdout).arrayBuffer(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (code !== 0) throw new Error(`${opts.host}:${opts.path}: ${err.trim() || "exit " + code}`);
        return new Uint8Array(bytes);
    } finally {
        clearTimeout(timer);
    }
}
