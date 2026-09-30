// Joern's program slicing, shrunk to what an LLM context window actually needs:
// the function's own source, plus the SIGNATURES of what it calls and who calls
// it. Reading ten whole files to change one function is how a context window
// gets spent on nothing.

/**
 * Assembles the minimal context needed to understand or change one function.
 *
 * Returns the function's full source, the one-line summaries and signatures of
 * everything it calls, and the call sites that would break if its contract
 * changed. This is the read to do before editing an unfamiliar function —
 * cheaper and more complete than opening files by hand. Requires `code.index`
 * to have run; signatures come from the `runtime.docs` registry.
 *
 * @param opts.name Runtime function name, such as `agent.compactContext`.
 * @param opts.includeSource Include the function's own file contents. @default true
 * @param opts.maxCallers Maximum incoming call sites to list. @default 25 @minimum 0 @maximum 200
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { name: string; includeSource?: boolean; maxCallers?: number },
): Promise<{
    name: string; found: boolean; rel?: string; summary?: string; signature?: string; source?: string;
    calls: Array<{ name: string; summary: string; signature: string }>;
    callers: Array<{ caller: string; rel: string; line: number }>;
    types: string[];
}> {
    const maxCallers = Math.min(Math.max(opts.maxCallers ?? 25, 0), 200);

    const [self] = await ctx.fns.procs.db.select({
        sql: "SELECT name, rel, kind FROM code_functions WHERE name = ? OR rel = ?",
        params: [opts.name, opts.name],
    });
    if (!self) return { name: opts.name, found: false, calls: [], callers: [], types: [] };

    const outgoing = await ctx.fns.procs.db.select({
        sql: "SELECT DISTINCT callee, kind FROM code_calls WHERE caller = ? ORDER BY callee",
        params: [self.name],
    });
    const callees = outgoing.filter((r: any) => r.kind !== "type").map((r: any) => r.callee);
    const types = outgoing.filter((r: any) => r.kind === "type").map((r: any) => r.callee);

    // Signatures come from the docs registry rather than being re-derived: one
    // source of truth for what a function's contract is.
    let calls: Array<{ name: string; summary: string; signature: string }> = [];
    if (callees.length) {
        const placeholders = callees.map(() => "?").join(",");
        const docs = await ctx.fns.procs.db.select({
            sql: `SELECT name, summary, signature FROM functions WHERE name IN (${placeholders}) ORDER BY name`,
            params: callees,
        });
        const known = new Map(docs.map((d: any) => [d.name, d]));
        calls = callees.map(n => {
            const d: any = known.get(n);
            return { name: n, summary: d?.summary ?? "", signature: d?.signature ?? "" };
        });
    }

    const callerRows = maxCallers > 0
        ? await ctx.fns.procs.db.select({
            sql: "SELECT caller, rel, line FROM code_calls WHERE callee = ? ORDER BY caller, line LIMIT ?",
            params: [self.name, maxCallers],
        })
        : [];

    let source: string | undefined;
    let summary: string | undefined;
    let signature: string | undefined;

    const [doc] = await ctx.fns.procs.db.select({ sql: "SELECT summary, signature FROM functions WHERE name = ?", params: [self.name] });
    if (doc) { summary = doc.summary; signature = doc.signature; }

    if (opts.includeSource !== false) {
        const entries = (await ctx.fns.procs.project.scan({})) as any[];
        const entry = entries.find(e => e.projectRel === self.rel);
        if (entry) source = await Bun.file(entry.abs).text().catch(() => undefined);
    }

    return {
        name: self.name, found: true, rel: self.rel, summary, signature, source,
        calls, types,
        callers: callerRows.map((r: any) => ({ caller: r.caller, rel: r.rel, line: Number(r.line) })),
    };
}
