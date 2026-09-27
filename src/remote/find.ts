/**
 * Finds files by glob pattern on an SSH server.
 *
 * Uses `rg --files` on the remote host when installed (respects .gitignore), otherwise `find`, skipping node_modules, .git, dist and build; matching uses the same glob semantics as the local find tool (a pattern without a slash matches at any depth). Backs the find tool when `host` is given.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.pattern Glob such as *.ts; a pattern without a slash matches at any depth, one with a slash is matched against the path relative to the searched directory.
 * @param opts.path Remote directory to search; relative to the remote home, ~/ allowed. @default .
 * @param opts.limit Maximum number of paths. @default 200 @minimum 1
 * @param opts.noIgnore Include ignored files (ripgrep only). @default false
 * @param opts.hidden Include dotfiles and dot-directories. @default false
 * @param opts.timeout Seconds before the walk is cut short. @default 60 @minimum 1
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** Glob such as *.ts; a pattern without a slash matches at any depth, one with a slash is matched against the path relative to the searched directory. */
        pattern: string;
        /** Remote directory to search; relative to the remote home, ~/ allowed. @default . */
        path?: string;
        /** Maximum number of paths. @default 200 @minimum 1 */
        limit?: number;
        /** Include ignored files (ripgrep only). @default false */
        noIgnore?: boolean;
        /** Include dotfiles and dot-directories. @default false */
        hidden?: boolean;
        /** Seconds before the walk is cut short. @default 60 @minimum 1 */
        timeout?: number;
    },
): Promise<{ paths: string[]; engine: "rg" | "find"; timedOut?: boolean }> {
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const p = opts.path || ".";
    const target = ctx.fns.remote.quote({ value: p, path: true });
    const limit = Math.max(1, opts.limit ?? 200);
    const rg = ["--files", "--no-require-git"]; if (opts.noIgnore) rg.push("--no-ignore"); else for (const d of ["node_modules", ".git", "dist", "build", ".runtime"]) rg.push("--glob", shq("!" + d)); if (opts.hidden) rg.push("--hidden");
    const prune = "\\( -name node_modules -o -name .git -o -name dist -o -name build -o -name .runtime" + (opts.hidden ? "" : " -o -name '.?*'") + " \\) -prune -o -type f -print";
    const script = "cd -- " + target + " 2>/dev/null || exit 2; if command -v rg >/dev/null; then echo ENGINE=rg; rg " + rg.join(" ") + " . 2>/dev/null; else echo ENGINE=find; find . -mindepth 1 " + prune + " 2>/dev/null; fi";
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: opts.timeout ?? 60 });
    if (r.exitCode === 2) throw new Error(opts.host + ": no such directory: " + p);
    // rg exits 1 when no files are listed; find exits 1 on unreadable subdirs (kept silent). 255 = ssh failed.
    if (r.exitCode !== 0 && r.exitCode !== 1 && !r.timedOut) throw new Error(opts.host + ": " + (r.stderr.trim() || "exit " + r.exitCode));
    const lines = r.stdout.split("\n");
    const engine = lines.shift() === "ENGINE=rg" ? "rg" : "find";
    const pat = String(opts.pattern || "*");
    const glob = new Bun.Glob(pat.includes("/") ? pat : "**/" + pat);
    const prefix = p === "." ? "" : p.replace(/\/$/, "") + "/";
    const paths: string[] = [];
    for (const l of lines) {
      const rel = l.replace(/^\.\//, "");
      if (!rel || !glob.match(rel)) continue;
      paths.push(prefix + rel);
      if (paths.length >= limit) break;
    }
    return { paths, engine, ...(r.timedOut ? { timedOut: true } : {}) };
}
