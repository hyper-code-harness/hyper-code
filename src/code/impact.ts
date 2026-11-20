/**
 * Estimates the blast radius of changing runtime functions in one call
 *
 * Answers "how risky is this change and what must I check" for one or more runtime functions, or for every function in files changed against a git ref.
 * Built on the same call graph as code.callers, but returns a digest instead of a raw list: a one-line summary, callers grouped into rings by hop distance, affected modules, entry points (routes, tools, crons) the change reaches, test files to run with a ready bun test command, affected functions no test reaches, and a short readFirst list of files to open before editing.
 * Use it before changing a signature or behaviour, and with diff: "HEAD" before committing. Unknown names come back in notFound with suggestions. Requires code.index to be current (it runs on every save).
 * @param opts.name Runtime function or type name such as `session.appendMessage`, or its file path relative to the scan root.
 * @param opts.names Several targets at once; their blast radii are merged.
 * @param opts.diff Git ref to diff the working tree against, such as `HEAD` or `main`; every function in a changed file becomes a target, changed and untracked test files are added to the tests to run.
 * @param opts.depth How many call-graph hops to walk back from the targets. @default 2 @minimum 1 @maximum 6
 * @param opts.limit Maximum individual call sites to list in callers; the summary and rings always count everything. @default 40 @minimum 0 @maximum 500
 * @param opts.readFirst Maximum files in the readFirst list. @default 8 @minimum 1 @maximum 30
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Runtime function or type name such as `session.appendMessage`, or its file path relative to the scan root. */
        name?: string;
        /** Several targets at once; their blast radii are merged. */
        names?: string[];
        /** Git ref to diff the working tree against, such as `HEAD` or `main`; every function in a changed file becomes a target, changed and untracked test files are added to the tests to run. */
        diff?: string;
        /** How many call-graph hops to walk back from the targets. @default 2 @minimum 1 @maximum 6 */
        depth?: number;
        /** Maximum individual call sites to list in callers; the summary and rings always count everything. @default 40 @minimum 0 @maximum 500 */
        limit?: number;
        /** Maximum files in the readFirst list. @default 8 @minimum 1 @maximum 30 */
        readFirst?: number;
    },
): Promise<{
    targets: string[];
    notFound: Array<{ name: string; suggestions: string[] }>;
    changedFiles: string[];
    summary: string;
    direct: number;
    total: number;
    files: number;
    modules: Array<{ module: string; functions: number }>;
    rings: Array<{ depth: number; functions: number; files: number; sample: string[] }>;
    entryPoints: string[];
    tests: { files: string[]; command: string };
    untested: string[];
    readFirst: string[];
    callers: Array<{ caller: string; path: string; line: number; depth: number; entryPoint: boolean }>;
    truncated: boolean;
}> {
    const { relative, isAbsolute, join } = await import("node:path");
    const depth = Math.min(Math.max(opts.depth ?? 2, 1), 6);
    const limit = Math.min(Math.max(opts.limit ?? 40, 0), 500);
    const readFirstMax = Math.min(Math.max(opts.readFirst ?? 8, 1), 30);
    const projectRoot: string = (ctx.state as any).root ?? process.cwd();
    
    // Scan roots → path prefix, so a graph `rel` (relative to its root) becomes a
    // path an agent can open, and a git path can be mapped back onto the graph.
    const roots = (await ctx.fns.procs.modules.discover({})) as Array<{ name: string; dir: string; prefix?: string }>;
    const rootDir = new Map<string, string>();
    for (const r of roots) if (!r.prefix && !rootDir.has(r.name)) rootDir.set(r.name, r.dir);
    const pathOf = (root: string, rel: string): string => {
        const dir = rootDir.get(root);
        if (!dir) return rel;
        const abs = join(dir, rel);
        const r = relative(projectRoot, abs);
        return r.startsWith("..") || isAbsolute(r) ? abs : r;
    };
    
    // 1. Targets: explicit names, or every function whose file changed against a git ref.
    const requested = [...(opts.names ?? []), ...(opts.name ? [opts.name] : [])];
    const changedFiles: string[] = [];
    const changedTests: string[] = [];
    let targetRows: Array<{ name: string; rel: string; root: string }> = [];
    if (opts.diff) {
        const res = await ctx.fns.git.run({ args: ["diff", "--name-only", opts.diff, "--"], dir: projectRoot, host: "local", allowFailure: true });
        if (!res.ok) throw new Error(`code.impact: git diff ${opts.diff} failed: ${res.stderr.trim()}`);
        const untracked = await ctx.fns.git.run({ args: ["ls-files", "--others", "--exclude-standard"], dir: projectRoot, host: "local", allowFailure: true });
        const files = [...new Set([...res.stdout.split("\n"), ...(untracked.ok ? untracked.stdout.split("\n") : [])].map(s => s.trim()).filter(f => /\.tsx?$/.test(f)))];
        for (const f of files) {
            changedFiles.push(f);
            if (/\.test\.tsx?$/.test(f)) { changedTests.push(f); continue; }
            const abs = join(projectRoot, f);
            for (const [root, dir] of rootDir) {
                const rel = relative(dir, abs);
                if (rel.startsWith("..") || isAbsolute(rel)) continue;
                const rows = await ctx.fns.procs.db.select({ sql: "SELECT name, rel, root FROM code_functions WHERE root = ? AND rel = ?", params: [root, rel] });
                targetRows.push(...(rows as any[]));
            }
        }
    }
    const notFound: Array<{ name: string; suggestions: string[] }> = [];
    for (const n of requested) {
        const rows = await ctx.fns.procs.db.select({ sql: "SELECT name, rel, root FROM code_functions WHERE name = ? OR rel = ?", params: [n, n] }) as any[];
        const typeRows = rows.length ? [] : await ctx.fns.procs.db.select({ sql: "SELECT 'types.' || name AS name, rel, root FROM code_types WHERE name = ? OR 'types.' || name = ?", params: [n, n] }) as any[];
        if (rows.length || typeRows.length) { targetRows.push(...rows, ...typeRows); continue; }
        // Typo-tolerant: trigram similarity on the full name and on its last segment.
        const last = n.split(".").pop() ?? n;
        const sug = await ctx.fns.procs.db.select({
            sql: `SELECT name FROM code_functions
                   WHERE kind = 'fn' AND (similarity(name, ?) > 0.3 OR similarity(split_part(name, '.', -1), ?) > 0.4 OR name ILIKE ?)
                   ORDER BY GREATEST(similarity(name, ?), similarity(split_part(name, '.', -1), ?)) DESC, name LIMIT 5`,
            params: [n, last, `%${last}%`, n, last],
        }) as any[];
        notFound.push({ name: n, suggestions: sug.map(s => s.name) });
    }
    const seenT = new Set<string>();
    targetRows = targetRows.filter(t => !seenT.has(t.name) && seenT.add(t.name));
    const targets = targetRows.map(t => t.name);
    
    const empty = { targets: [], notFound, changedFiles, summary: notFound.length ? `not found: ${notFound.map(n => n.name).join(", ")}` : "nothing to analyse", direct: 0, total: 0, files: 0, modules: [], rings: [], entryPoints: [], tests: { files: changedTests, command: changedTests.length ? `bun test ${changedTests.join(" ")}` : "" }, untested: [], readFirst: [], callers: [], truncated: false };
    if (!targets.length) return empty;
    
    // 2. Blast radius: everything that reaches a target through real (non-test) calls.
    const ph = targets.map(() => "?").join(",");
    const rows = await ctx.fns.procs.db.select({
        sql: `
            WITH RECURSIVE up(caller, rel, line, kind, depth) AS (
                SELECT c.caller, c.rel, c.line, c.kind, 1 FROM code_calls c
                 WHERE c.callee IN (${ph}) AND c.kind NOT IN ('test', 'dynamic')
                UNION
                SELECT c.caller, c.rel, c.line, c.kind, up.depth + 1 FROM code_calls c
                  JOIN up ON c.callee = up.caller
                 WHERE up.depth < ? AND c.kind NOT IN ('test', 'dynamic')
            )
            SELECT up.caller, up.rel, up.line, up.kind, MIN(up.depth) AS depth,
                   COALESCE(f.entry_point, FALSE) AS entry_point, f.root, f.kind AS fkind
              FROM up LEFT JOIN code_functions f ON f.name = up.caller
             GROUP BY up.caller, up.rel, up.line, up.kind, f.entry_point, f.root, f.kind
             ORDER BY depth, up.caller, up.line`,
        params: [...targets, depth],
    }) as any[];
    const targetSet = new Set(targets);
    const sites = rows.filter(r => !targetSet.has(r.caller)).map(r => ({
        caller: r.caller as string, path: pathOf(r.root ?? "core", r.rel), line: Number(r.line),
        depth: Number(r.depth), entryPoint: r.entry_point === true, isFn: r.fkind === "fn",
    }));
    const fnDepth = new Map<string, number>();
    for (const s of sites) fnDepth.set(s.caller, Math.min(fnDepth.get(s.caller) ?? 99, s.depth));
    const rings = [...new Set(sites.map(s => s.depth))].sort((a, b) => a - b).map(d => {
        const fns = [...fnDepth].filter(([, dd]) => dd === d).map(([n]) => n);
        const files = new Set(sites.filter(s => s.depth === d).map(s => s.path));
        return { depth: d, functions: fns.length, files: files.size, sample: fns.slice(0, 8) };
    });
    const modCount = new Map<string, number>();
    for (const n of fnDepth.keys()) { const m = n.split(".")[0]!; modCount.set(m, (modCount.get(m) ?? 0) + 1); }
    const modules = [...modCount].sort((a, b) => b[1] - a[1]).map(([module, functions]) => ({ module, functions }));
    const entryPoints = [...new Set(sites.filter(s => s.entryPoint).map(s => s.caller))];
    
    // 3. Tests: the test files that call any affected function directly.
    const affected = [...targets, ...fnDepth.keys()];
    const aph = affected.map(() => "?").join(",");
    const testRows = await ctx.fns.procs.db.select({
        sql: `SELECT DISTINCT c.rel, f.root FROM code_calls c LEFT JOIN code_functions f ON f.name = c.callee
               WHERE c.kind = 'test' AND c.callee IN (${aph}) ORDER BY c.rel`,
        params: affected,
    }) as any[];
    const testFiles = [...new Set([...changedTests, ...testRows.map(r => pathOf(r.root ?? "core", r.rel))])];
    
    // 4. Untested: affected runtime functions no test reaches, even through other functions.
    const untestedRows = await ctx.fns.procs.db.select({
        sql: `
            WITH RECURSIVE reached AS (
                SELECT DISTINCT c.callee AS name, 1 AS d FROM code_calls c WHERE c.kind = 'test'
                UNION
                SELECT c.callee, r.d + 1 FROM reached r JOIN code_calls c ON c.caller = r.name
                 WHERE c.kind = 'fn' AND r.d < 6
            )
            SELECT f.name FROM code_functions f
             WHERE f.name IN (${aph}) AND f.kind = 'fn'
               AND NOT EXISTS (SELECT 1 FROM reached r WHERE r.name = f.name)
             ORDER BY f.name`,
        params: affected,
    }) as any[];
    const untested = untestedRows.map(r => r.name as string);
    
    // 5. Read first: the targets' own files, then the files with the most direct call sites.
    const readFirst: string[] = [];
    // Targets first, but leave room for the busiest caller files when a diff touched many.
    const targetCap = Math.max(1, Math.ceil(readFirstMax / 2));
    for (const t of targetRows) { if (readFirst.length >= targetCap) break; const p = pathOf(t.root, t.rel); if (!readFirst.includes(p)) readFirst.push(p); }
    const byFile = new Map<string, number>();
    for (const s of sites) if (s.depth === 1) byFile.set(s.path, (byFile.get(s.path) ?? 0) + 1);
    for (const [p] of [...byFile].sort((a, b) => b[1] - a[1])) { if (readFirst.length >= readFirstMax) break; if (!readFirst.includes(p)) readFirst.push(p); }
    
    const direct = [...fnDepth.values()].filter(d => d === 1).length;
    const files = new Set(sites.map(s => s.path)).size;
    const summary = `${targets.length === 1 ? targets[0] : `${targets.length} functions`}: ${direct} direct callers, ${fnDepth.size} within ${depth} hops, ${files} files, ${modules.length} modules, ${entryPoints.length} entry points, ${testFiles.length} test files, ${untested.length} untested`;
    
    return {
        targets, notFound, changedFiles, summary,
        direct, total: fnDepth.size, files, modules: modules.slice(0, 15), rings,
        entryPoints: entryPoints.slice(0, 30),
        tests: { files: testFiles, command: testFiles.length ? `bun test ${testFiles.join(" ")}` : "" },
        untested: untested.slice(0, 50), readFirst,
        callers: sites.slice(0, limit).map(({ isFn: _x, ...s }) => s),
        truncated: sites.length > limit,
    };
}
