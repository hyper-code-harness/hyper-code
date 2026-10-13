/**
 * Ranks Hyper modules by change risk and transitive impact
 *
 * Use this read-only analysis before refactoring or review to find modules with many dependents, weak test reachability, broad reverse impact, or ownership-boundary warnings. It reuses Hyper’s indexed ctx.fns graph and does not parse source again.
 * @param opts.module Module to expand with its complete reverse-impact list, such as agent or session.
 * @param opts.depth Maximum reverse-dependency steps used for impact analysis. @default 3 @minimum 1 @maximum 8
 * @param opts.limit Maximum ranked modules and boundary violations to return. @default 50 @minimum 1 @maximum 500
 * @param opts.scope Analyze all modules, only core/local modules, or only official/user plugin modules. @default all
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Module to expand with its complete reverse-impact list, such as agent or session. */
        module?: string;
        /** Maximum reverse-dependency steps used for impact analysis. @default 3 @minimum 1 @maximum 8 */
        depth?: number;
        /** Maximum ranked modules and boundary violations to return. @default 50 @minimum 1 @maximum 500 */
        limit?: number;
        /** Analyze all modules, only core/local modules, or only official/user plugin modules. @default all */
        scope?: "all" | "core" | "plugins";
    },
): Promise<{ generatedAt: number; scope: string; depth: number; totals: { modules: number; functions: number; boundaryWarnings: number; boundaryErrors: number }; methodology: { risk: string; caveat: string }; selected: any; modules: any[]; boundaries: any[] }> {
    const depth = opts.depth ?? 3;
    const limit = opts.limit ?? 50;
    const scope = opts.scope ?? "all";
    const focus = opts.module?.trim() || null;
    const [functions, calls, boundary] = await Promise.all([
      ctx.fns.procs.db.select({ sql: `select name, root, rel, tier, entry_point from code_functions order by name`, params: [] }),
      ctx.fns.procs.db.select({ sql: `select caller, callee, rel, line, kind from code_calls where not discarded`, params: [] }),
      ctx.fns.code.boundary({ limit: 5000 }),
    ]);
    const moduleOf = (name: string, rel?: string, sourceRoot?: string) => { const relPart = rel?.split("/")[0]; if (relPart && relPart !== rel) return relPart; const clean = name.replace(/^types\./, ""); if (clean.startsWith("$") && sourceRoot) return sourceRoot === "core" ? "core" : sourceRoot; const dot = clean.indexOf("."); if (dot > 0) return clean.slice(0, dot); const slash = clean.indexOf("/"); if (slash > 0) return clean.slice(0, slash); return clean; };
    const functionRows = functions as Array<{ name: string; root: string; rel: string; tier: string; entry_point: boolean }>;
    const callRows = calls as Array<{ caller: string; callee: string; rel: string; line: number; kind: string }>;
    const byName = new Map(functionRows.map(fn => [fn.name, fn]));
    const allowed = (fn: { tier: string }) => scope === "all" || (scope === "core" ? fn.tier === "core" || fn.tier === "local" : fn.tier === "official" || fn.tier === "user");
    const modules = new Map<string, { id: string; tier: string; roots: Set<string>; functions: number; entryPoints: number; directTested: Set<string>; testReached: Set<string>; callers: Set<string>; callees: Set<string>; callSites: number; boundary: number }>();
    for (const fn of functionRows) { if (!allowed(fn)) continue; const id = moduleOf(fn.name, fn.rel, fn.root); const m = modules.get(id) ?? { id, tier: fn.tier, roots: new Set<string>(), functions: 0, entryPoints: 0, directTested: new Set<string>(), testReached: new Set<string>(), callers: new Set<string>(), callees: new Set<string>(), callSites: 0, boundary: 0 }; m.functions++; m.roots.add(fn.root); if (fn.entry_point) m.entryPoints++; modules.set(id, m); }
    const production = callRows.filter(c => c.kind !== "test");
    const testTargets = new Set(callRows.filter(c => c.kind === "test").map(c => c.callee));
    const outgoingFns = new Map<string, string[]>(); for (const c of production) { const list = outgoingFns.get(c.caller) ?? []; list.push(c.callee); outgoingFns.set(c.caller, list); }
    const queue = [...testTargets].map(name => ({ name, d: 0 })); const reached = new Set(testTargets); while (queue.length) { const item = queue.shift()!; if (item.d >= 6) continue; for (const next of outgoingFns.get(item.name) ?? []) if (!reached.has(next)) { reached.add(next); queue.push({ name: next, d: item.d + 1 }); } }
    for (const fn of functionRows) { const m = modules.get(moduleOf(fn.name, fn.rel, fn.root)); if (!m) continue; if (testTargets.has(fn.name)) m.directTested.add(fn.name); if (reached.has(fn.name)) m.testReached.add(fn.name); }
    const edgeMap = new Map<string, { source: string; target: string; weight: number; samples: Array<{ rel: string; line: number }> }>();
    for (const c of production) { const callerRow = byName.get(c.caller); const calleeRow = byName.get(c.callee); const s = moduleOf(c.caller, callerRow?.rel ?? c.rel, callerRow?.root), t = moduleOf(c.callee, calleeRow?.rel, calleeRow?.root); if (s === t || !modules.has(s) || !modules.has(t)) continue; const key = s + "→" + t; const e = edgeMap.get(key) ?? { source: s, target: t, weight: 0, samples: [] }; e.weight++; if (e.samples.length < 3) e.samples.push({ rel: c.rel, line: c.line }); edgeMap.set(key, e); modules.get(s)!.callees.add(t); modules.get(t)!.callers.add(s); modules.get(s)!.callSites++; }
    for (const v of boundary.violations) { const fn = byName.get(v.caller); const id = moduleOf(v.caller, fn?.rel ?? v.rel, fn?.root); if (modules.has(id)) modules.get(id)!.boundary++; }
    const edges = [...edgeMap.values()]; const reverse = new Map<string, string[]>(); for (const e of edges) { const list = reverse.get(e.target) ?? []; list.push(e.source); reverse.set(e.target, list); }
    const impactFor = (id: string) => { const seen = new Map<string, number>([[id, 0]]); let front = [id]; for (let d = 1; d <= depth; d++) { const next: string[] = []; for (const cur of front) for (const caller of reverse.get(cur) ?? []) if (!seen.has(caller)) { seen.set(caller, d); next.push(caller); } front = next; } return [...seen.entries()].filter(([name]) => name !== id).map(([module, distance]) => ({ module, distance })).sort((a,b)=>a.distance-b.distance||a.module.localeCompare(b.module)); };
    const reports = [...modules.values()].map(m => { const untested = Math.max(0, m.functions - m.testReached.size); const coverage = m.functions ? m.testReached.size / m.functions : 0; const impact = impactFor(m.id); const fanIn = m.callers.size, fanOut = m.callees.size; const score = Math.round(Math.min(100, 12 * Math.log2(1 + fanIn) + 8 * Math.log2(1 + fanOut) + 35 * (1 - coverage) + Math.min(20, impact.length * 1.5) + Math.min(15, m.boundary * 5))); const reasons: string[] = []; if (fanIn >= 5) reasons.push(fanIn + " modules depend on it"); if (coverage < .5) reasons.push(Math.round((1 - coverage) * 100) + "% of functions are not test-reached"); if (impact.length >= 5) reasons.push(impact.length + " modules can be affected within " + depth + " steps"); if (m.boundary) reasons.push(m.boundary + " ownership-boundary warning(s)"); return { id: m.id, tier: m.tier, roots: [...m.roots].sort(), functions: m.functions, entryPoints: m.entryPoints, fanIn, fanOut, callSites: m.callSites, testEvidence: { direct: m.directTested.size, reached: m.testReached.size, none: untested, pctReached: Math.round(coverage * 1000) / 10 }, impactCount: impact.length, impact: focus === m.id ? impact : impact.slice(0, 10), boundaryWarnings: m.boundary, risk: score, reasons }; }).sort((a,b)=>b.risk-a.risk||b.impactCount-a.impactCount||a.id.localeCompare(b.id));
    const selected = focus ? reports.find(r => r.id === focus) ?? null : null;
    return { generatedAt: Date.now(), scope, depth, totals: { modules: reports.length, functions: reports.reduce((n,r)=>n+r.functions,0), boundaryWarnings: boundary.warnings, boundaryErrors: boundary.errors }, methodology: { risk: "fan-in + fan-out + missing test reachability + transitive reverse impact + boundary warnings", caveat: "Static ctx.fns call graph: dynamic dispatch and raw SQL dependencies are not visible." }, selected, modules: reports.slice(0, limit), boundaries: boundary.violations.slice(0, limit) };
}
