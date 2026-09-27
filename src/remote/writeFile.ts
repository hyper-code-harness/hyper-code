/**
 * Writes a UTF-8 text file on a remote SSH server, creating parent directories.
 *
 * Streams the content through stdin of the persistent remote.exec connection into an exclusive temp file, then renames it into place atomically, keeping the file mode and writing through symlinks. With expectedContent the rename happens under a per-file lock only if the file still has that content. Relative paths resolve against the remote home; ~/ is supported. Used by files.write and host-aware tools when a `host` is given.
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
    const rp = ctx.fns.remote.quote({ value: opts.path, path: true });
    const md5 = opts.expectedContent != null ? new Bun.CryptoHasher("md5").update(opts.expectedContent).digest("hex") : "";
    // 1. Upload into a private temp file (mktemp: exclusive, unpredictable) next
    //    to the target, so the final rename is atomic on the same filesystem.
    // 2. Under a per-file lock (mkdir is atomic) re-check the expected content,
    //    copy the current mode onto the temp file, then rename over the target.
    //    Cooperating writers (agents using this function) serialize on the lock;
    //    a writer that ignores it can still race — the check narrows, not closes, that window.
    // A symlink is written through to its target instead of being replaced.
    const script = [
        "f=" + rp,
        '[ -L "$f" ] && f=$(readlink -f -- "$f" 2>/dev/null || echo "$f")',
        'd=$(dirname -- "$f"); mkdir -p -- "$d" || exit 1',
        't=$(mktemp "$d/.hyper-write.XXXXXX") || exit 1',
        'l="$f.hyper-lock"; locked=0',
        'cleanup(){ rm -f -- "$t"; [ "$locked" = 1 ] && rmdir -- "$l" 2>/dev/null; }',
        "trap cleanup EXIT",
        'cat > "$t" || exit 1',
        'i=0; until mkdir -- "$l" 2>/dev/null; do i=$((i+1)); [ $i -ge 100 ] && { echo "file is locked by another writer: $f" >&2; exit 8; }; sleep 0.05; done; locked=1',
        md5 ? 'cur=$( { md5sum -- "$f" 2>/dev/null || md5 -r -- "$f"; } | cut -d" " -f1); [ "$cur" = ' + md5 + " ] || { echo 'file changed on the server since it was read; re-read and retry' >&2; exit 9; }" : ":",
        'if [ -e "$f" ]; then m=$(stat -c %a -- "$f" 2>/dev/null || stat -f %Lp -- "$f" 2>/dev/null) && chmod "$m" "$t"; else chmod 644 "$t"; fi',
        'mv -f -- "$t" "$f"',
    ].join("\n");
    const r = await ctx.fns.remote.exec({ host: opts.host, stdin: opts.content, command: script });
    if (r.exitCode !== 0) throw new Error(`${opts.host}:${opts.path}: ${(r.stderr || "exit " + r.exitCode).trim()}`);
    return { bytes: Buffer.byteLength(opts.content) };
}
