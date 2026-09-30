// "Who calls this?" — the question the registry could never answer, because
// ctx.fns dispatch means nothing imports anything.

/**
 * Lists every call site of a runtime function, directly or transitively.
 *
 * Answers "what breaks if I change this signature" with concrete files and line
 * numbers, and with `depth > 1` walks back up the call chain to the entry points
 * that ultimately reach it. Reads the tables `code.index` builds, so reindex
 * after editing files. Pass a type name (`types.agent.Agent`) to find its users.
 *
 * @param opts.name Runtime function name such as `session.appendMessage`, or a type name such as `types.agent.Agent`.
 * @param opts.depth How many call-graph hops to walk back; 1 lists direct callers only. @default 1 @minimum 1 @maximum 10
 * @param opts.limit Maximum call sites to return. @default 200 @minimum 1 @maximum 2000
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { name: string; depth?: number; limit?: number },
): Promise<{ name: string; exists: boolean; total: number; callers: Array<{ caller: string; rel: string; line: number; kind: string; depth: number; entryPoint: boolean }> }> {
    const depth = Math.min(Math.max(opts.depth ?? 1, 1), 10);
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);

    const found = await ctx.fns.procs.db.select({
        sql: "SELECT 1 FROM code_functions WHERE name = ? UNION ALL SELECT 1 FROM code_types WHERE name = ? OR 'types.' || name = ?",
        params: [opts.name, opts.name, opts.name],
    });

    // Recursive CTE = Joern's reachableBy, minus the worker pool: shortest depth
    // wins, and the visited set is what keeps a cyclic graph terminating.
    const rows = await ctx.fns.procs.db.select({
        sql: `
            WITH RECURSIVE up(caller, callee, rel, line, kind, depth) AS (
                SELECT c.caller, c.callee, c.rel, c.line, c.kind, 1
                  FROM code_calls c
                 WHERE c.callee = ?
                UNION
                SELECT c.caller, c.callee, c.rel, c.line, c.kind, up.depth + 1
                  FROM code_calls c
                  JOIN up ON c.callee = up.caller
                 WHERE up.depth < ?
            )
            SELECT up.caller, up.rel, up.line, up.kind, MIN(up.depth) AS depth,
                   COALESCE(f.entry_point, FALSE) AS entry_point
              FROM up
              LEFT JOIN code_functions f ON f.name = up.caller
             GROUP BY up.caller, up.rel, up.line, up.kind, f.entry_point
             ORDER BY depth, up.caller, up.line
             LIMIT ?`,
        params: [opts.name, depth, limit],
    });

    return {
        name: opts.name,
        exists: found.length > 0,
        total: rows.length,
        callers: rows.map((r: any) => ({
            caller: r.caller, rel: r.rel, line: Number(r.line), kind: r.kind,
            depth: Number(r.depth), entryPoint: r.entry_point === true,
        })),
    };
}
