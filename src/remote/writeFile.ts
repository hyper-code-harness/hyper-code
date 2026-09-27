/**
 * Writes a UTF-8 text file on a remote SSH server, creating parent directories.
 *
 * Streams the content through stdin of the persistent remote.exec connection into a temp file, then renames it into place atomically. Relative paths resolve against the remote home; ~/ is supported. Used by files.write and host-aware tools when a `host` is given.
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers).
 * @param opts.path Remote file path; relative to the remote home, ~/ allowed.
 * @param opts.content Full file body written verbatim.
 * @param opts.expectedContent Expected current file content (as previously read); when set, the write is refused if the remote file changed in the meantime.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config (see remote.servers). */
        host: string;
        /** Remote file path; relative to the remote home, ~/ allowed. */
        path: string;
        /** Full file body written verbatim. */
        content: string;
        /** Expected current file content (as previously read); when set, the write is refused if the remote file changed in the meantime. */
        expectedContent?: string;
    },
): Promise<{ bytes: number }> {
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const rp = ctx.fns.remote.quote({ value: opts.path, path: true });
    // Compare-and-swap: the edit tool reads, edits locally, and writes back;
    // refuse to clobber a file someone changed in between.
    const md5 = opts.expectedContent != null ? new Bun.CryptoHasher("md5").update(opts.expectedContent).digest("hex") : "";
    const guard = md5 ? "cur=$( { md5sum \"$f\" 2>/dev/null || md5 -r \"$f\"; } | cut -d' ' -f1); [ \"$cur\" = " + md5 + " ] || { echo 'file changed on the server since it was read; re-read and retry' >&2; exit 9; }; " : "";
    const r = await ctx.fns.remote.exec({ host: opts.host, stdin: opts.content, command: "f=" + rp + "; " + guard + "mkdir -p \"$(dirname \"$f\")\" && t=\"$f.hyper-tmp.$$\" && cat > \"$t\" && mv -f \"$t\" \"$f\"" });
    if (r.exitCode !== 0) throw new Error(`${opts.host}:${opts.path}: ${(r.stderr || "exit " + r.exitCode).trim()}`);
    return { bytes: Buffer.byteLength(opts.content) };
}
