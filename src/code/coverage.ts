/**
 * Reports which runtime functions tests actually exercise, ranked by what depends on them.
 *
 * Answers the question "what is most dangerous to change right now" rather than
 * producing a single coverage percentage: a function with thirty callers and no
 * test is a real risk, while an untested leaf is usually not. Reads the indexed
 * call graph, so it covers the whole project in milliseconds and needs no test
 * run. Three levels of evidence are distinguished, because they mean different
 * things:
 *
 *   direct      some test calls it by name — the function itself is checked
 *   indirect    a test reaches it through other functions — exercised, not pinned
 *   none        no test reaches it at all
 *
 * A sibling `<fn>.test.ts` file is deliberately NOT the measure: it says a file
 * exists, not that anything in it touches the function. Counted that way this
 * codebase looks 22% covered; counted by actual test calls, 44%.
 *
 * @param opts.root Scan root to report on, such as `core` for `src/`. @default "core"
 * @param opts.status Only list functions with this evidence level: `direct`, `indirect` or `none`.
 * @param opts.minCallers Only list functions with at least this many callers — the risk filter. @default 0 @minimum 0
 * @param opts.depth How far a test call may propagate to count as indirect. @default 6 @minimum 1 @maximum 10
 * @param opts.limit Maximum functions to list. @default 30 @minimum 1 @maximum 500
 * @returns Totals per evidence level plus the ranked list of functions.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: {
        root?: string;
        status?: "direct" | "indirect" | "none";
        minCallers?: number;
        depth?: number;
        limit?: number;
    },
): Promise<{
    root: string;
    total: number;
    direct: number;
    indirect: number;
    none: number;
    pctDirect: number;
    pctAny: number;
    untestedWithCallers: number;
    functions: Array<{ name: string; rel: string; status: "direct" | "indirect" | "none"; callers: number; testCalls: number }>;
}> {
    const root = opts?.root ?? "core";
    const depth = Math.min(Math.max(opts?.depth ?? 6, 1), 10);
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 500);
    const minCallers = Math.max(opts?.minCallers ?? 0, 0);

    // One query for everything: the recursive term walks forward from every
    // function a test calls, so "indirect" means a real path exists in the graph
    // rather than a guess from file names. Entry points are included — a route
    // nobody tests is exactly as risky as a function nobody tests.
    const rows = await ctx.fns.procs.db.select({
        sql: `
        WITH RECURSIVE reached AS (
            SELECT DISTINCT c.callee AS name, 1 AS d
              FROM code_calls c
             WHERE c.kind = 'test'
            UNION
            SELECT c.callee, r.d + 1
              FROM reached r
              JOIN code_calls c ON c.caller = r.name
             WHERE c.kind = 'fn' AND r.d < ?
        ),
        direct AS (
            SELECT c.callee AS name, count(*) AS test_calls
              FROM code_calls c
             WHERE c.kind = 'test'
             GROUP BY c.callee
        ),
        callers AS (
            SELECT c.callee AS name, count(DISTINCT c.caller) AS n
              FROM code_calls c
             WHERE c.kind = 'fn'
             GROUP BY c.callee
        )
        SELECT f.name,
               f.rel,
               COALESCE(d.test_calls, 0)                       AS test_calls,
               COALESCE(cl.n, 0)                               AS callers,
               CASE WHEN d.name IS NOT NULL THEN 'direct'
                    WHEN EXISTS (SELECT 1 FROM reached r WHERE r.name = f.name) THEN 'indirect'
                    ELSE 'none' END                            AS status
          FROM code_functions f
          LEFT JOIN direct  d  ON d.name  = f.name
          LEFT JOIN callers cl ON cl.name = f.name
         WHERE f.kind = 'fn' AND f.root = ?
         ORDER BY callers DESC, f.name`,
        params: [depth, root],
    }) as Array<{ name: string; rel: string; test_calls: number | string; callers: number | string; status: string }>;

    const all = rows.map(r => ({
        name: r.name,
        rel: r.rel,
        status: r.status as "direct" | "indirect" | "none",
        callers: Number(r.callers),
        testCalls: Number(r.test_calls),
    }));

    const direct = all.filter(f => f.status === "direct").length;
    const indirect = all.filter(f => f.status === "indirect").length;
    const none = all.length - direct - indirect;

    // The number worth watching: untested AND something depends on it. A plain
    // percentage moves when leaf helpers are added and says nothing about risk.
    const untestedWithCallers = all.filter(f => f.status === "none" && f.callers > 0).length;

    const listed = all
        .filter(f => !opts?.status || f.status === opts.status)
        .filter(f => f.callers >= minCallers);

    return {
        root,
        total: all.length,
        direct,
        indirect,
        none,
        pctDirect: all.length ? Math.round(direct / all.length * 100) : 0,
        pctAny: all.length ? Math.round((direct + indirect) / all.length * 100) : 0,
        untestedWithCallers,
        functions: listed.slice(0, limit),
    };
}
