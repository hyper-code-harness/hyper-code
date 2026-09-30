// Functions nobody calls, and functions only their own test calls. The two are
// different diagnoses: the first is a deletion candidate, the second is code
// kept alive solely by its test. Lumping them together is how a checker earns
// the reputation of crying wolf and gets switched off.
//
// Entry points are excluded entirely: a route, a cron or a tool is invoked by
// the framework and has no in-edge by construction.

/**
 * Lists runtime functions that production code never calls.
 *
 * Separates functions with no callers at all from those reached only by their
 * own tests, and skips entry points (routes, crons, tools, lifecycle hooks) that
 * the framework invokes directly. Use it to find leftovers after a refactor.
 * Results are candidates, not verdicts: a function reached through dynamic
 * dispatch or named in a plugin's prompt looks dead here.
 *
 * @param opts.root Limit to one scan root, such as `core` for `src/` or a plugin name.
 * @param opts.includeTestOnly Also list functions whose only callers are tests. @default true
 * @param opts.limit Maximum functions to return. @default 100 @minimum 1 @maximum 1000
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: { root?: string; includeTestOnly?: boolean; limit?: number },
): Promise<{
    total: number; uncalledTotal: number; testOnlyTotal: number;
    functions: Array<{ name: string; rel: string; root: string; status: "uncalled" | "test-only"; testCallers: number }>;
}> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 1000);
    const includeTestOnly = opts?.includeTestOnly !== false;
    const where = opts?.root ? "AND f.root = ?" : "";
    const params: any[] = opts?.root ? [opts.root] : [];

    // One pass, two verdicts: count a function's non-test callers and its test
    // callers, then classify. Doing it in SQL keeps the two numbers consistent
    // with each other by construction.
    const sql = `
        WITH counted AS (
            SELECT f.name, f.rel, f.root,
                   (SELECT COUNT(*) FROM code_calls c WHERE c.callee = f.name AND c.kind <> 'test') AS live,
                   (SELECT COUNT(*) FROM code_calls c WHERE c.callee = f.name AND c.kind =  'test') AS tested
              FROM code_functions f
             WHERE f.entry_point = FALSE AND f.kind = 'fn' ${where}
        )
        SELECT name, rel, root, tested,
               CASE WHEN tested = 0 THEN 'uncalled' ELSE 'test-only' END AS status
          FROM counted
         WHERE live = 0 ${includeTestOnly ? "" : "AND tested = 0"}
         ORDER BY tested, root, name`;

    const all = await ctx.fns.procs.db.select({ sql, params });

    const uncalledTotal = all.filter((r: any) => r.status === "uncalled").length;
    const testOnlyTotal = all.filter((r: any) => r.status === "test-only").length;

    return {
        total: all.length,
        uncalledTotal,
        testOnlyTotal,
        functions: all.slice(0, limit).map((r: any) => ({
            name: r.name, rel: r.rel, root: r.root,
            status: r.status as "uncalled" | "test-only",
            testCallers: Number(r.tested),
        })),
    };
}
