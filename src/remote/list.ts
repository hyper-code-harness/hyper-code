/**
 * Lists the immediate children of a directory on an SSH server.
 *
 * Returns names with a directory flag, directories first then alphabetical,
 * skipping node_modules, .git and .DS_Store like the local files.list. Used by
 * files.list and the Files UI for remote paths.
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers).
 * @param opts.path Remote directory; relative to the remote home, ~/ allowed.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config (see remote.servers). */
        host: string;
        /** Remote directory; relative to the remote home, ~/ allowed. */
        path: string;
    },
): Promise<Array<{ name: string; isDir: boolean }>> {
    const p = ctx.fns.remote.quote({ value: opts.path || "~", path: true });
    // One NUL-separated "d|f<TAB>name" record per entry; names may contain anything but NUL.
    const script = "cd -- " + p + " 2>/dev/null || { echo 'no such directory' >&2; exit 2; }; "
        + "for e in .* *; do case \"$e\" in .|..) continue;; esac; [ -e \"$e\" ] || [ -L \"$e\" ] || continue; "
        + "if [ -d \"$e\" ]; then printf 'd\\t%s\\0' \"$e\"; else printf 'f\\t%s\\0' \"$e\"; fi; done";
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: 30 });
    if (r.exitCode !== 0) throw new Error(`${opts.host}:${opts.path}: ${(r.stderr || "exit " + r.exitCode).trim()}`);
    const skip = new Set(["node_modules", ".git", ".DS_Store"]);
    return r.stdout.split("\0").filter(Boolean)
        .map(rec => ({ name: rec.slice(2), isDir: rec[0] === "d" }))
        .filter(e => e.name && !skip.has(e.name))
        .sort((a, b) => a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name));
}
