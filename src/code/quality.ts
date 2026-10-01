// Everything the call graph can say against this codebase, in one answer.
//
// The pieces already existed — code.boundary, code.dead, the unresolved and
// dynamic edges code.index counts — and that was the problem: three calls to
// remember, each with its own shape, so nobody ran them. One function that
// reports every warning in a single list is a thing you can actually glance at,
// and `ok` makes it usable as a check.
//
// Severities mean what they do in code.boundary, deliberately:
//   error  this is broken for anyone but this machine, or the graph is wrong
//   warn   a design smell: true, but not a reason to stop the world
// `ok` follows errors only. A gate that fails on smells gets switched off.
//
// Honest about its own blind spots: see `blind` in the result. Raw SQL against
// another module's schema, dynamic dispatch and anything reached only by string
// are invisible here, and a checker that implies otherwise is worse than none.

import ts from "typescript";

type Finding = {
    kind: "boundary" | "unresolved" | "dead" | "test-only" | "floating-promise" | string;
    severity: "error" | "warn";
    name: string;
    rel: string;
    line?: number;
    detail: string;
};

/**
 * Reports every warning the indexed call graph can raise about this codebase.
 *
 * Collects boundary violations (committed code calling a private per-machine
 * plugin), calls to names no function provides, promises nobody awaits, uncalled
 * functions, functions kept alive only by their own test, and the per-file rule
 * violations the indexer recorded while parsing — one ranked list instead of
 * several queries. Reads the stored graph, so the whole project is answered in
 * milliseconds; run `code.index` first if the tree changed. `ok` is true when
 * there are no errors.
 *
 * @param opts.root Limit findings to one scan root, such as `core` for `src/`. Defaults to `core` for the dead-code checks, whose answer is meaningless for plugins.
 * @param opts.severity Only report this severity: `error` or `warn`.
 * @param opts.include Which checks to run. Omit for all of them. @default ["boundary","unresolved","dead","test-only","rules","floating-promise","untested"]
 * @param opts.rule Only this rule, e.g. `empty-catch`, `lost-cause`, `formdata-to-string`, `floating-promise`, `untested`.
 * @param opts.limit Maximum findings to return. @default 50 @minimum 1 @maximum 500
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: {
        root?: string;
        severity?: "error" | "warn";
        include?: Array<"boundary" | "unresolved" | "dead" | "test-only" | "rules" | "floating-promise" | "untested">;
        rule?: string;
        limit?: number;
    },
): Promise<{
    ok: boolean;
    errors: number;
    warnings: number;
    counts: Record<string, number>;
    findings: Finding[];
    blind: string[];
}> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 500);
    // `rule` narrows by the finding's kind, whichever check produced it, so
    // `{ rule: "dead" }` and `{ rule: "empty-catch" }` behave the same way.
    const wantRule = (kind: string) => !opts?.rule || kind === opts.rule;
    const include = new Set(opts?.include ?? ["boundary", "unresolved", "dead", "test-only", "rules", "floating-promise", "untested"]);
    const findings: Finding[] = [];

    if (include.has("boundary") && wantRule("boundary")) {
        const b = await ctx.fns.code.boundary({ limit: 500 });
        for (const v of b.violations) {
            if (opts?.root && !v.rel.startsWith(opts.root === "core" ? "" : opts.root)) continue;
            findings.push({
                kind: "boundary", severity: v.severity, name: v.caller,
                rel: v.rel, line: v.line, detail: `calls ${v.callee} — ${v.reason}`,
            });
        }
    }

    // A call to a name nothing provides. Either the callee is gone and this is a
    // latent crash, or the indexer cannot see it — both are worth a look, and in
    // practice this number dropping to ~0 is what makes the rest trustworthy.
    //
    // The ignored kinds must match code.index exactly, or the two disagree about
    // the same tree. `string` matters most: UI dispatch and CDP commands look
    // like `Input.dispatchMouseEvent` and resolve to nothing by design — counting
    // them reported 33 errors where there is 1.
    if (include.has("unresolved") && wantRule("unresolved")) {
        // db.select is untyped by design (it answers any query), so the shape of
        // this particular result is named here instead of being carried around as
        // `any` — the compiler then checks the field names below.
        type UnresolvedRow = { caller: string; callee: string; rel: string; line: number | string };
        const rows = await ctx.fns.procs.db.select({
            sql: `SELECT c.caller, c.callee, c.rel, c.line
                    FROM code_calls c
                    LEFT JOIN code_functions f ON f.name = c.callee
                   WHERE f.name IS NULL AND c.kind NOT IN ('type', 'dynamic', 'string', 'test')
                   ${opts?.root ? "AND EXISTS (SELECT 1 FROM code_functions cf WHERE cf.name = c.caller AND cf.root = ?)" : ""}
                   ORDER BY c.rel, c.line`,
            params: opts?.root ? [opts.root] : [],
        }) as UnresolvedRow[];

        // The absolute path of each file comes from the scanner, not from gluing
        // `rel` onto a guessed root: a plugin lives at plugins/<name>/src/<rel>,
        // and guessing that wrong made this check silently pass on everything.
        const absByRel = new Map<string, string>();
        if (rows.length) {
            type Scanned = { projectRel: string; abs: string };
            for (const e of (await ctx.fns.procs.project.scan({})) as Scanned[]) absByRel.set(e.projectRel, e.abs);
        }
        for (const r of rows) {
            // A call the author already knows might not be there is not a finding.
            // `if (ctx.fns.services) await ctx.fns.services.track({})` and
            // `ctx.fns.google.cdpOpen?.(…)` are how an optional module is used
            // correctly, and reporting them trains the reader to ignore this list.
            const abs = absByRel.get(r.rel);
            if (abs && await isGuarded(r.callee, abs, Number(r.line))) continue;
            findings.push({
                kind: "unresolved", severity: "error", name: r.caller, rel: r.rel, line: Number(r.line),
                detail: `calls ${r.callee}, which no indexed function provides`,
            });
        }
    }

    // Rule violations the indexer wrote while it was parsing each file anyway.
    // Reading them back is a SELECT, which is the whole point: the project stays
    // checked without anyone paying to re-read 1315 files to ask.
    if (include.has("rules")) {
        type RuleRow = { rel: string; line: number | string; rule: string; severity: string; detail: string };
        const rows = await ctx.fns.procs.db.select({
            sql: `SELECT rel, line, rule, severity, detail FROM code_findings
                   WHERE 1=1 ${opts?.root ? "AND root = ?" : ""} ${opts?.rule ? "AND rule = ?" : ""}
                   ORDER BY rel, line`,
            params: [...(opts?.root ? [opts.root] : []), ...(opts?.rule ? [opts.rule] : [])],
        }) as RuleRow[];
        for (const r of rows) {
            findings.push({
                kind: r.rule, severity: r.severity === "error" ? "error" : "warn",
                name: r.rel, rel: r.rel, line: Number(r.line), detail: r.detail,
            });
        }
    }

    // A promise nobody waits for. Neither half of this is visible on its own: the
    // call site knows the result is dropped, the callee knows it returns a
    // promise, and only the join of the two is a finding. A text scan that
    // skipped this reported 199 — of which 189 were calls to synchronous
    // functions, where there is nothing to await.
    if (include.has("floating-promise") && wantRule("floating-promise")) {
        type FloatRow = { caller: string; callee: string; rel: string; line: number | string };
        const rows = await ctx.fns.procs.db.select({
            sql: `SELECT c.caller, c.callee, c.rel, c.line
                    FROM code_calls c
                    JOIN code_functions f ON f.name = c.callee
                   WHERE c.discarded = TRUE AND f.is_async = TRUE AND c.kind = 'fn'
                   ${opts?.root ? "AND EXISTS (SELECT 1 FROM code_functions cf WHERE cf.name = c.caller AND cf.root = ?)" : ""}
                   ORDER BY c.rel, c.line`,
            params: opts?.root ? [opts.root] : [],
        }) as FloatRow[];
        for (const r of rows) {
            findings.push({
                kind: "floating-promise", severity: "warn", name: r.caller, rel: r.rel, line: Number(r.line),
                detail: `calls ${r.callee} without awaiting it — an error there is lost silently`,
            });
        }
    }

    // A function with callers that no test ever reaches. Not every function needs
    // one, so this is deliberately not "coverage is below N%": the finding is the
    // pair "nothing pins this behaviour" AND "other code depends on it", which is
    // the only version of the question with an obvious action attached.
    //
    // Why measured from the graph rather than from `bun test --coverage`: under
    // this harness lcov stops attributing function bodies once the run spans more
    // than ~8 test files — escape.ts reports FNH:2 alone and FNH:0 in the full
    // suite, though its four assertions pass either way. Calls recorded at index
    // time do not have that failure mode.
    if (include.has("untested") && wantRule("untested")) {
        const cov = await ctx.fns.code.coverage({ root: opts?.root ?? "core", status: "none", minCallers: 1, limit: 500 });
        for (const f of cov.functions) {
            findings.push({
                kind: "untested", severity: "warn", name: f.name, rel: f.rel,
                detail: `${f.callers} function(s) depend on it and no test reaches it`,
            });
        }
    }

    if ((include.has("dead") && wantRule("dead")) || (include.has("test-only") && wantRule("test-only"))) {
        // Scoped to one root, `core` unless asked otherwise. A plugin's functions
        // are its PUBLIC surface: the agent calls them by name after reading the
        // docs, so "no code calls this" is the normal state for almost all of
        // them. Reporting 174 of those as dead buries the dozen findings in src/
        // that are real.
        const deadRoot = opts?.root ?? "core";
        const d = await ctx.fns.code.dead({ root: deadRoot, includeTestOnly: include.has("test-only"), limit: 500 });
        for (const f of d.functions) {
            const testOnly = f.status === "test-only";
            if (testOnly && !include.has("test-only")) continue;
            if (!testOnly && !(include.has("dead") && wantRule("dead"))) continue;
            if (testOnly && !(include.has("test-only") && wantRule("test-only"))) continue;
            findings.push({
                kind: testOnly ? "test-only" : "dead",
                severity: "warn",
                name: f.name, rel: f.rel,
                detail: testOnly
                    ? `only its own test calls it (${f.testCallers} call site(s))`
                    : "nothing calls it, and it is not an entry point",
            });
        }
    }

    const picked = opts?.severity ? findings.filter(f => f.severity === opts.severity) : findings;
    const counts: Record<string, number> = {};
    for (const f of picked) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    const errors = picked.filter(f => f.severity === "error").length;

    return {
        ok: errors === 0,
        errors,
        warnings: picked.length - errors,
        counts,
        // Errors first, then the cheap-to-read kinds: the list is skimmed from
        // the top and the broken things have to be there.
        findings: picked
            .sort((a, b) => (a.severity === b.severity ? a.kind.localeCompare(b.kind) : a.severity === "error" ? -1 : 1))
            .slice(0, limit),
        blind: [
            "raw SQL against another module's schema is not a call and is not seen",
            "dispatch through a computed `ctx.fns[name]` cannot be resolved; such sites are counted by code.index",
            "a function named in a prompt or a tool file counts as an entry point, not as dead",
            "the dead-code checks cover one root at a time, `core` by default: a plugin function with no caller is usually just its public API",
            "a call to an optional module behind `if (ctx.fns.x)` or `x?.()` is treated as deliberate, not as unresolved",
            "floating promises are only seen for ctx.fns calls: an unawaited Bun.spawn or fetch is invisible here",
            "the per-file rules read syntax, not types: they cannot tell what a value actually is at runtime",
            "`untested` means no test CALLS the function; it does not claim the test that does call it checks anything useful",
        ],
    };
}

// Is this call site written as a call that may legitimately not resolve? Two
// idioms count: an optional-chaining call, and a guard on the namespace anywhere
// in the same function body. Read from the file rather than the graph, because
// what matters is the shape of the source at that line.
// Is this call site written as a call that may legitimately not resolve?
//
// Two idioms count, and both are read from the TypeScript AST rather than from
// the text of the line: an optional call (`x.y?.()`) and a guard on the
// namespace (`if (ctx.fns.services)`, `if (!(ctx.fns as any).services) return`).
// A regex was tried here first and was wrong twice in five minutes — once on the
// parentheses a cast introduces, once on a plugin path it could not guess —
// which is the lesson code.index already learned.
async function isGuarded(callee: string, abs: string, line: number): Promise<boolean> {
    const ns = callee.split(".")[0];
    if (!ns) return false;
    const text = await Bun.file(abs).text().catch(() => "");
    if (!text) return false;

    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let guarded = false;

    const visit = (node: ts.Node): void => {
        if (guarded) return;

        // `ctx.fns.google.cdpOpen?.(…)` — the author said it may be absent.
        if (ts.isCallExpression(node) && node.questionDotToken
            && sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 === line) {
            guarded = true;
            return;
        }

        // A condition that reads `…fns.<ns>` as a value is a mount check:
        // `if (ctx.fns.services)`, `if (!(ctx.fns as any).services) return`.
        if (ts.isIfStatement(node) && readsFnsNamespace(node.expression, sf, ns)) {
            guarded = true;
            return;
        }

        ts.forEachChild(node, visit);
    };
    visit(sf);
    return guarded;
}

// Does this expression read `…fns.<ns>` as a value — testing whether the module
// is mounted — rather than call into it?
function readsFnsNamespace(node: ts.Node, sf: ts.SourceFile, ns: string): boolean {
    let hit = false;
    const walk = (n: ts.Node): void => {
        if (hit) return;
        if (ts.isPropertyAccessExpression(n) && n.name.text === ns) {
            let cur: ts.Node = n.expression;
            while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
            if (/(?:^|\.)fns$/.test(cur.getText(sf))) { hit = true; return; }
        }
        ts.forEachChild(n, walk);
    };
    walk(node);
    return hit;
}
