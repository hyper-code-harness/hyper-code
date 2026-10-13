/**
 * Ranks Hyper source files by cached Git churn and code complexity
 *
 * Use this read-only analysis to find refactoring candidates that are both difficult and frequently changed. Run architectureMap.indexGit first after HEAD changes; this function joins that Postgres cache to current source metrics and classifies Danger Zone, Cowboy Code, Fertile Ground, and Healthy files.
 * @param opts.root Limit analysis to one Hyper source root, such as core or browser.
 * @param opts.includeTests Include test files in the ranked results. @default false
 * @param opts.limit Maximum ranked files returned. @default 500 @minimum 1 @maximum 5000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Limit analysis to one Hyper source root, such as core or browser. */
        root?: string;
        /** Include test files in the ranked results. @default false */
        includeTests?: boolean;
        /** Maximum ranked files returned. @default 500 @minimum 1 @maximum 5000 */
        limit?: number;
    },
): Promise<{ generatedAt: number; filters: { root: string | null; includeTests: boolean; limit: number }; cache: any[]; thresholds: { complexityMedian: number; churnMedian: number }; totals: Record<string, number>; methodology: Record<string, string>; files: any[] }> {
    const root = opts.root?.trim() || null; const limit = opts.limit ?? 500; const includeTests = opts.includeTests ?? false; const scan = await ctx.fns.procs.project.scan({});
    const entries = (scan as Array<{ root: string; abs: string; projectRel: string; kind: string }>).filter(e => (!root || e.root === root) && (includeTests || !e.abs.endsWith(".test.ts")) && !["skip", "type"].includes(e.kind));
    const repoRows = await ctx.fns.procs.db.select({ sql: "select repo_dir,head_sha,indexed_at,history_start,commits,shallow from architecture_map.git_repos order by repo_dir", params: [] }); const repoDirs: string[] = repoRows.map((r: any) => String(r.repo_dir)).sort((a: string,b: string)=>b.length-a.length);
    const metricRows = await ctx.fns.procs.db.select({ sql: "select rel,root,lines,source_lines,functions,cyclomatic_total,cyclomatic_max,cognitive_total,cognitive_max,nesting_max,parameters_max from code_file_metrics" + (root ? " where root=?" : ""), params: root ? [root] : [] });
    const metrics = new Map(metricRows.map((m: any) => [String(m.root) + "\u0000" + String(m.rel), m]));
    const files: any[] = [];
    for (const e of entries) { const repo = repoDirs.find((d: string) => e.abs.startsWith(d + "/")); if (!repo) continue; const path = e.abs.slice(repo.length + 1); const metric: any = metrics.get(e.root + "\u0000" + e.projectRel); if (!metric) continue; const stat = await ctx.fns.procs.db.select({ sql: "select commits,additions,deletions,last_commit_at from architecture_map.git_file_stats where repo_dir=? and path=?", params: [repo, path] }); const s: any = stat[0] ?? {}; const commits = Number(s.commits ?? 0), additions = Number(s.additions ?? 0), deletions = Number(s.deletions ?? 0), churn = additions + deletions; files.push({ root: e.root, repo, path, rel: e.projectRel, lines: Number(metric.lines), sourceLines: Number(metric.source_lines), complexity: Number(metric.cyclomatic_total), worstFunction: Number(metric.cyclomatic_max), cognitive: Number(metric.cognitive_total), worstCognitive: Number(metric.cognitive_max), nestingMax: Number(metric.nesting_max), parametersMax: Number(metric.parameters_max), functions: Number(metric.functions), commits, additions, deletions, churn, quadrant: "", danger: 0, lastCommitAt: s.last_commit_at ?? null }); }
    const median = (xs: number[]) => { const a = [...xs].sort((x,y)=>x-y); return a.length ? Number(a[Math.floor((a.length-1)/2)] ?? 0) : 0; }; const complexityMedian = median(files.map(f=>f.complexity)); const churnMedian = median(files.map(f=>f.commits)); const logC = Math.log1p(Math.max(1, complexityMedian)), logH = Math.log1p(Math.max(1, churnMedian)); for (const f of files) { const highC = f.complexity > complexityMedian, highH = f.commits > churnMedian; f.quadrant = highC && highH ? "danger" : highC ? "cowboy" : highH ? "fertile" : "healthy"; const u = Math.log1p(f.commits) / logH, v = Math.log1p(f.complexity) / logC; f.danger = Math.round(100 * Math.sqrt(u*u + v*v)) / 100; }
    files.sort((a,b)=>b.danger-a.danger||a.path.localeCompare(b.path)); const counts: Record<string,number> = { danger:0, fertile:0, cowboy:0, healthy:0 }; for (const f of files) counts[f.quadrant] = Number(counts[f.quadrant] ?? 0) + 1;
    return { generatedAt: Date.now(), filters: { root, includeTests, limit }, cache: repoRows, thresholds: { complexityMedian, churnMedian }, totals: { files: files.length, ...counts }, methodology: { complexity: "classic cyclomatic complexity per function from the TypeScript AST, rolled up as file total and worst function; cognitive complexity, nesting and parameter counts are retained as diagnostics", churn: "non-merge Git commits and added+deleted lines, creation commit excluded, renames detected", danger: "Euclidean distance of median-normalized log1p commit churn and cyclomatic complexity" }, files: files.slice(0, limit) };
}
