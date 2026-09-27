/**
 * Reads a remote file as raw bytes over SSH, for images, PDFs and other binary content.
 *
 * Streams `cat` output over the persistent SSH connection without UTF-8
 * decoding. Refuses files larger than maxBytes, counting bytes as they arrive
 * (the transfer is cut at the limit even if the file grows meanwhile). Use remote.readFile for text.
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
        cmd: [ssh.bin, "-T", ...ssh.args, opts.host, "bash -lc " + ctx.fns.remote.quote({ value: script })],
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 120_000);
    // The size check above is a snapshot: the file may grow or be replaced
    // before cat runs. Count bytes as they arrive and stop at the limit, so the
    // transfer and the memory it takes are bounded no matter what.
    const chunks: Uint8Array[] = [];
    let total = 0, overflow = false;
    const errText = new Response(proc.stderr).text();
    try {
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
            total += chunk.byteLength;
            if (total > max) { overflow = true; proc.kill(); break; }
            chunks.push(chunk);
        }
        const code = await proc.exited;
        if (overflow) throw new Error(`${opts.host}:${opts.path}: file too large: more than ${max} bytes`);
        if (code !== 0) throw new Error(`${opts.host}:${opts.path}: ${(await errText).trim() || "exit " + code}`);
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { out.set(c, at); at += c.byteLength; }
        return out;
    } finally {
        clearTimeout(timer);
        if (proc.exitCode === null) proc.kill();
    }
}
