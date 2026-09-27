/**
 * Searches file contents on an SSH server and returns ripgrep-style matches with optional context lines.
 *
 * Uses ripgrep on the remote host when installed (respects .gitignore), otherwise falls back to grep -rn with node_modules/.git/dist/build skipped. Paths are relative to the remote home unless absolute. Backs the grep tool when `host` is given.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.pattern Regular expression (extended syntax), or plain text when literal is true.
 * @param opts.path Remote directory or file to search; relative to the remote home, ~/ allowed. @default .
 * @param opts.glob File-name glob restricting searched files, e.g. *.ts.
 * @param opts.ignoreCase Case-insensitive matching. @default false
 * @param opts.literal Treat the pattern as literal text. @default false
 * @param opts.context Lines of context before and after each match. @default 0 @minimum 0 @maximum 20
 * @param opts.limit Maximum number of matches. @default 50 @minimum 1
 * @param opts.noIgnore Search ignored files too (ripgrep only). @default false
 * @param opts.hidden Include hidden files and directories. @default false
 * @param opts.timeout Seconds before the search is cut short. @default 60 @minimum 1
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** Regular expression (extended syntax), or plain text when literal is true. */
        pattern: string;
        /** Remote directory or file to search; relative to the remote home, ~/ allowed. @default . */
        path?: string;
        /** File-name glob restricting searched files, e.g. *.ts. */
        glob?: string;
        /** Case-insensitive matching. @default false */
        ignoreCase?: boolean;
        /** Treat the pattern as literal text. @default false */
        literal?: boolean;
        /** Lines of context before and after each match. @default 0 @minimum 0 @maximum 20 */
        context?: number;
        /** Maximum number of matches. @default 50 @minimum 1 */
        limit?: number;
        /** Search ignored files too (ripgrep only). @default false */
        noIgnore?: boolean;
        /** Include hidden files and directories. @default false */
        hidden?: boolean;
        /** Seconds before the search is cut short. @default 60 @minimum 1 */
        timeout?: number;
    },
): Promise<{ matches: Array<{ path: string; line: number; column: number; text: string; before?: string[]; after?: string[] }>; engine: "rg" | "grep" }> {
    const shq = (s: string) => ctx.fns.remote.quote({ value: s });
    const p = opts.path || ".";
    const target = ctx.fns.remote.quote({ value: p, path: true });
    const limit = Math.max(1, opts.limit ?? 50);
    const ctxN = Math.max(0, Math.min(20, opts.context ?? 0));
    const rgArgs = ["--json", "--no-require-git", "--max-columns=2000"];
    // Same vendored-dir skip as the grep fallback, even where no .gitignore exists.
    if (!opts.noIgnore) for (const d of ["node_modules", ".git", "dist", "build", ".runtime"]) rgArgs.push("--glob", shq("!" + d));
    if (opts.ignoreCase) rgArgs.push("-i");
    if (opts.literal) rgArgs.push("-F");
    if (opts.glob) rgArgs.push("--glob", shq(opts.glob));
    if (opts.noIgnore) rgArgs.push("--no-ignore");
    if (opts.hidden) rgArgs.push("--hidden");
    if (ctxN) rgArgs.push("-C", String(ctxN));
    // -H: print the file name even when the target is a single file.
    const grArgs = ["-rnIH", opts.literal ? "-F" : "-E"];
    if (opts.ignoreCase) grArgs.push("-i");
    if (opts.glob) grArgs.push("--include=" + shq(opts.glob));
    for (const d of ["node_modules", ".git", "dist", "build", ".runtime"]) grArgs.push("--exclude-dir=" + d);
    if (!opts.hidden) grArgs.push("--exclude-dir='.?*'");
    if (ctxN) grArgs.push("-C", String(ctxN));
    const cap = (limit * (2 * ctxN + 2) + 50) * 3;
    // Search from inside the target so rows carry the caller's relative paths, not the expanded remote home.
    const script = "t=" + target + "; [ -e \"$t\" ] || { echo \"no such file or directory: " + p.replaceAll("\"", "") + "\" >&2; exit 2; }; if [ -d \"$t\" ]; then cd \"$t\"; s=.; echo KIND=d; else cd \"$(dirname \"$t\")\"; s=\"$(basename \"$t\")\"; echo KIND=f; fi; "
        + "if command -v rg >/dev/null; then echo ENGINE=rg; rg " + rgArgs.join(" ") + " -- " + shq(opts.pattern) + " \"$s\" | head -n " + cap + "; else echo ENGINE=grep; grep " + grArgs.join(" ") + " -- " + shq(opts.pattern) + " \"$s\" | head -n " + cap + "; fi; exit 0";
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: opts.timeout ?? 60 });
    if (r.exitCode !== 0 && !r.timedOut) throw new Error(opts.host + ": " + (r.stderr || "exit " + r.exitCode).trim());
    const lines = r.stdout.split("\n");
    const kind = lines.shift();
    const engine = lines.shift() === "ENGINE=rg" ? "rg" : "grep";
    const base = kind === "KIND=d" ? (p === "." ? "" : p.replace(/\/$/, "") + "/") : (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
    const fix = (x: string) => base + x.replace(/^\.\//, "");
    type M = { path: string; line: number; column: number; text: string; before?: string[]; after?: string[] };
    const matches: M[] = [];
    const re = opts.literal ? null : (() => { try { return new RegExp(opts.pattern, opts.ignoreCase ? "i" : ""); } catch { return null; } })();
    const colOf = (t: string) => {
      if (opts.literal) { const i = opts.ignoreCase ? t.toLowerCase().indexOf(opts.pattern.toLowerCase()) : t.indexOf(opts.pattern); return Math.max(0, i) + 1; }
      const m = re?.exec(t); return (m?.index ?? 0) + 1;
    };
    if (engine === "rg") {
      let pending: string[] = [];
      let last: M | null = null;
      for (const l of lines) {
        if (!l.trim()) continue;
        let ev: any; try { ev = JSON.parse(l); } catch { continue; }
        if (ev.type === "begin" || ev.type === "end") { last = null; pending = []; continue; }
        const text = String(ev.data?.lines?.text ?? "").replace(/\r?\n$/, "");
        const path = fix(String(ev.data?.path?.text ?? ""));
        const line = Number(ev.data?.line_number ?? 0);
        if (ev.type === "match") {
          if (matches.length >= limit) break;
          const m: M = { path, line, column: Number(ev.data?.submatches?.[0]?.start ?? 0) + 1, text };
          if (ctxN) { m.before = pending.slice(-ctxN); m.after = []; }
          pending = []; matches.push(m); last = m;
        } else if (ev.type === "context") {
          if (last && last.after && last.after.length < ctxN && line === last.line + 1 + last.after.length) last.after.push(text);
          else pending.push(text);
        }
      }
    } else {
      const rx = /^(.*?)([:-])(\d+)\2(.*)$/;
      let pending: string[] = [];
      let last: M | null = null;
      for (const l of lines) {
        if (l === "--") { last = null; pending = []; continue; }
        const m = rx.exec(l); if (!m) continue;
        const [, path, sep, num, text] = m as unknown as [string, string, string, string, string];
        const line = Number(num);
        if (sep === ":") {
          if (matches.length >= limit) break;
          const mm: M = { path: fix(path), line, column: colOf(text), text };
          if (ctxN) { mm.before = pending.slice(-ctxN); mm.after = []; }
          pending = []; matches.push(mm); last = mm;
        } else if (last && last.after && last.after.length < ctxN && line === last.line + 1 + last.after.length) last.after.push(text);
        else pending.push(text);
      }
    }
    return { matches, engine };
}
