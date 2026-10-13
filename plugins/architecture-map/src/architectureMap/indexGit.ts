/**
 * Indexes and caches per-file Git churn for Hyper source roots
 *
 * Run this before turbulence analysis when repository HEADs change. It discovers Git repositories from Hyper source roots, scans non-merge history with rename detection, excludes each file’s creation commit from churn counts, and caches results in Postgres; unchanged HEADs are reused.
 * @param opts.root Limit indexing to one Hyper source root, such as core or browser.
 * @param opts.force Rebuild cached statistics even when the repository HEAD is unchanged. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Limit indexing to one Hyper source root, such as core or browser. */
        root?: string;
        /** Rebuild cached statistics even when the repository HEAD is unchanged. @default false */
        force?: boolean;
    },
): Promise<{ roots: string[]; repositories: Array<{ repo: string; head: string; status: string; files: number; commits: number; shallow: boolean }>; indexedAt: number }> {
    const rootFilter = opts.root?.trim() || null;
    const scan = await ctx.fns.procs.project.scan({});
    const entries = (scan as Array<{ root: string; rootDir: string; abs: string }>).filter(e => !rootFilter || e.root === rootFilter);
    const repos = new Map<string, Set<string>>();
    for (const entry of entries) { let dir = entry.rootDir; let repo = ""; while (dir !== "/") { if (await Bun.file(dir + "/.git/HEAD").exists()) { repo = dir; break; } dir = dir.slice(0, dir.lastIndexOf("/")) || "/"; } if (repo) { const paths = repos.get(repo) ?? new Set<string>(); paths.add(entry.abs.slice(repo.length + 1)); repos.set(repo, paths); } }
    const git = async (cwd: string, args: string[]) => { const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" }); const text = await new Response(p.stdout).text(); const error = await new Response(p.stderr).text(); if (await p.exited) throw new Error(error.trim()); return text; };
    const output: Array<{ repo: string; head: string; status: string; files: number; commits: number; shallow: boolean }> = [];
    for (const [repo, wanted] of repos) { const head = (await git(repo, ["rev-parse", "HEAD"])).trim(); const old = await ctx.fns.procs.db.select({ sql: "select head_sha,commits,shallow from architecture_map.git_repos where repo_dir=?", params: [repo] }); if (!opts.force && old[0]?.head_sha === head) { const count = await ctx.fns.procs.db.select({ sql: "select count(*)::int n from architecture_map.git_file_stats where repo_dir=?", params: [repo] }); output.push({ repo, head, status: "cached", files: count[0]?.n ?? 0, commits: old[0]?.commits ?? 0, shallow: old[0]?.shallow ?? false }); continue; }
    const shallow = (await git(repo, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
    // Read the whole reachable history. A pathspec here would silently drop history from before a file or directory rename.
    const raw = await git(repo, ["log", "--no-merges", "--format=@@@%H%x1f%ct", "--numstat", "-M"]);
    type Stat = { commits: number; additions: number; deletions: number; creationAdditions: number; creationDeletions: number; createdSha: string; lastSha: string; lastAt: number };
    const stats = new Map<string, Stat>();
    const aliases = new Map<string, string>([...wanted].map(path => [path, path]));
    let sha = "", at = 0, commitCount = 0, oldest = 0;
    for (const line of raw.split("\n")) {
        if (line.startsWith("@@@")) { const parts = line.slice(3).split("\x1f"); sha = parts[0] ?? ""; at = Number(parts[1] ?? 0); commitCount++; if (!oldest || at < oldest) oldest = at; continue; }
        const match = /^([0-9-]+)\t([0-9-]+)\t(.+)$/.exec(line); if (!match || !sha) continue;
        const shown = match[3] ?? ""; let oldPath = shown, newPath = shown;
        if (shown.includes(" => ")) { const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(shown); if (brace) { oldPath = (brace[1] ?? "") + (brace[2] ?? "") + (brace[4] ?? ""); newPath = (brace[1] ?? "") + (brace[3] ?? "") + (brace[4] ?? ""); } else { const pair = shown.split(" => "); oldPath = pair[0] ?? shown; newPath = pair[1] ?? shown; } }
        const canonical = aliases.get(newPath) ?? aliases.get(oldPath); if (!canonical) continue; if (oldPath !== newPath) aliases.set(oldPath, canonical);
        const add = match[1] === "-" ? 0 : Number(match[1] ?? 0), del = match[2] === "-" ? 0 : Number(match[2] ?? 0);
        const s = stats.get(canonical) ?? { commits: 0, additions: 0, deletions: 0, creationAdditions: 0, creationDeletions: 0, createdSha: sha, lastSha: sha, lastAt: at };
        s.commits++; s.additions += add; s.deletions += del; s.creationAdditions = add; s.creationDeletions = del; s.createdSha = sha; stats.set(canonical, s);
    }
    await ctx.fns.procs.db.run({ sql: "delete from architecture_map.git_file_stats where repo_dir=?", params: [repo] }); await ctx.fns.procs.db.run({ sql: `insert into architecture_map.git_repos(repo_dir,head_sha,indexed_at,history_start,commits,shallow) values(?,?,now(),to_timestamp(?),?,?) on conflict(repo_dir) do update set head_sha=excluded.head_sha,indexed_at=now(),history_start=excluded.history_start,commits=excluded.commits,shallow=excluded.shallow`, params: [repo, head, oldest, commitCount, shallow] });
    for (const [path, s] of stats) await ctx.fns.procs.db.run({ sql: `insert into architecture_map.git_file_stats(repo_dir,path,commits,additions,deletions,created_sha,last_commit_sha,last_commit_at) values(?,?,?,?,?,?,?,to_timestamp(?))`, params: [repo, path, Math.max(0, s.commits - 1), Math.max(0, s.additions - s.creationAdditions), Math.max(0, s.deletions - s.creationDeletions), s.createdSha, s.lastSha, s.lastAt] }); output.push({ repo, head, status: "indexed", files: stats.size, commits: commitCount, shallow }); }
    return { roots: [...new Set(entries.map(e => e.root))].sort(), repositories: output, indexedAt: Date.now() };
}
