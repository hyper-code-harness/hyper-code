// Rebuild the call graph from source text.
//
// Cross-imports between project files are forbidden here, so EVERY edge between
// two runtime functions is a literal `ctx.fns.<ns>.<fn>(` in the source — the
// call graph is already explicit, nothing has to be inferred.
//
// That made a regex tempting, and it worked until it didn't: a regex cannot tell
// a call from the same text quoted inside a string, and this codebase does both.
// `procs.repl.explain` RETURNS the advice "await ctx.fns.services.restart(…)" as
// a string to show a human, which the regex read as an edge to a function that
// does not exist. Blanking string literals first was worse — it also erased the
// genuine call inside a template's `${…}` two lines below. So: the TypeScript
// parser, which knows the difference by construction. It costs a few hundred ms
// for 1600 functions, which is cheap enough to run on every save.
//
// Still honest about the one thing no parser can resolve: a dynamic
// `ctx.fns[name]` dispatch is counted and returned, so the blind spot is
// reported rather than hidden.
import ts from "typescript";

// The fields of procs.project.scan this file actually reads. Named once so the
// compiler checks them, instead of `any` hiding a typo until a query comes back
// empty.
type ScanEntry = {
    kind: string; abs: string; projectRel: string; root: string;
    moduleDir: string; module?: string; runtimeName?: string; fileName: string;
};

// A row bound for a bulk INSERT: the column order is positional by nature.
type Row = Array<string | number | boolean | null>;

// The slice of a Bun SQL transaction this file uses.
type SqlTx = { unsafe: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Rebuilds the `code_functions`, `code_types` and `code_calls` tables from source.
 *
 * Walks every file `procs.project.scan` knows about and records the runtime
 * functions, the exported type files and one row per `ctx.fns.<ns>.<fn>` call
 * site, plus UI string dispatch such as `hx-popup="agent.modelPicker"`. Calls
 * made from `*.test.ts` are recorded as `test` edges, so dead-code reporting
 * can tell "nothing calls this" from "only its test calls this". Run it after
 * adding, deleting or renaming files; `code.callers`, `code.dead` and
 * `code.slice` read what it writes. Takes about 250ms for the whole tree, so
 * reindexing on demand is cheaper than reasoning about staleness.
 *
 * @param opts.root Limit the scan to one root, such as `core` for `src/`, `hyper` for `.hyper/`, or a plugin name.
 * @param opts.rel Re-index just this one project-relative file, such as `agent/run.ts`; a file that no longer exists is removed from the graph.
 * @param opts.dryRun Compute the counts without touching the database. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: { root?: string; rel?: string; dryRun?: boolean },
): Promise<{ functions: number; types: number; calls: number; unresolved: number; dynamic: Array<{ rel: string; line: number }>; ms: number }> {
    const started = Date.now();
    const entries = (await ctx.fns.procs.project.scan({})) as ScanEntry[];
    const now = Date.now();

    // Entry points are called by the framework, never from code: a route is hit
    // over HTTP, a cron by the scheduler, a tool by the model. They have zero
    // in-edges by nature and must never be mistaken for dead code.
    const ENTRY = new Set(["route", "cron", "tool", "lifecycle", "app", "middleware", "compaction", "gap", "point", "hook"]);
    const wanted = (e: ScanEntry) => (e.kind === "fn" || ENTRY.has(e.kind)) && e.abs.endsWith(".ts") && !e.abs.endsWith(".test.ts");

    // A third kind of entry point, invisible in the call graph: functions the
    // system prompt teaches the model to call. `agent.delegate` has no caller
    // in the source and is used constantly. Without this the dead-code list
    // opens with the agent's own API and nobody believes the rest of it.
    const promptNames = await agentFacingNames(ctx, entries);

    // Who owns each scan root: code this repo commits, an official plugin under
    // plugins/, or a private one mounted from ~/.hyper/user. Stored per function
    // so `code.boundary` can ask the question later without re-reading mounts.
    const tierByRoot = await tiers(ctx);

    const inScope = (e: ScanEntry) => (!opts?.root || e.root === opts.root) && (!opts?.rel || e.projectRel === opts.rel);
    const files = entries.filter(e => wanted(e) && inScope(e));
    const typeFiles = entries.filter(e => e.kind === "type" && inScope(e));
    // Tests are not part of the registry, but a call from a test IS a call — it
    // is just a different kind of one. Recording them as `test` edges is what
    // lets dead-code reporting separate "nothing calls this" from "only its own
    // test calls this", which are different diagnoses with different fixes.
    const testFiles = entries.filter(e => e.abs.endsWith(".test.ts") && inScope(e));

    const fnRows: Row[] = [];
    const typeRows: Row[] = [];
    const callRows: Row[] = [];
    const findingRows: Row[] = [];
    const dynamic: Array<{ rel: string; line: number }> = [];

    // The dotted name a file answers to. Computed without reading anything, so
    // it can be done for the whole tree before any call is resolved.
    const nameOf = (e: ScanEntry): string => {
        if (e.kind !== "fn" || !e.runtimeName) return e.projectRel;
        return e.moduleDir === "." ? e.runtimeName : `${e.moduleDir.replaceAll("/", ".")}.${e.runtimeName}`;
    };

    // Every name the registry has, not just the ones in scope: resolving a call
    // needs the whole picture even when only one file is being re-indexed.
    const allNames = new Set<string>(entries.filter(wanted).map(nameOf));

    for (const e of typeFiles) {
        // Mirrors genTypes: src/<mod>/<Name>.ts is referred to as types.<mod>.<Name>.
        const stem = e.fileName.replace(/^\$type_/, "").replace(/\.ts$/, "");
        const name = (e.module ? `${e.module.replaceAll("/", ".")}.` : "") + stem;
        typeRows.push([name, e.projectRel, e.root, now]);
    }

    // A dotted name that could be a runtime function, used to decide whether a
    // string is dispatch or ordinary prose.
    const STRING_TARGET = /^[a-z][\w$]*(?:\.[\w$]+)+$/;

    // One reader for both kinds of file. A second copy of "what counts as a
    // call" would drift from this one within a week.
    //
    // Real calls come from the TypeScript AST, not from a regex over lines. The
    // regex had no way to tell `ctx.fns.a.b({})` from the same text quoted inside
    // a string, and this codebase does both: `procs.repl.explain` RETURNS
    // "await ctx.fns.services.restart(…)" as advice to a human. Blanking string
    // literals first was worse than either — it also removed the genuine call
    // inside a template's `${…}` on the next line of that same file. The AST
    // knows the difference by construction.
    const scanCalls = (text: string, from: string, rel: string, edgeKind: string) => {
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true,
            rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                const target = callTarget(node, sf);
                if (target) {
                    // Two segments or three? `runtime.docs.search` is a nested
                    // module and `procs.db.select` is too, while `shop.charge(…)`
                    // followed by `.then` is not. Ask the registry instead of
                    // hardcoding which prefixes nest: the longer name wins only
                    // if such a function actually exists.
                    const parts = target.split(".");
                    const two = parts.slice(0, 2).join(".");
                    const three = parts.length > 2 ? parts.slice(0, 3).join(".") : null;
                    const callee = three && allNames.has(three) ? three : two;
                    // Is the result dropped? A call that is its own statement,
                    // with no `await`, no `.then`, no `.catch` and no `void`,
                    // discards whatever comes back. That only matters when the
                    // callee returns a promise — which the graph records per
                    // function, so the question is answered later by a JOIN
                    // rather than guessed here.
                    if (callee !== from) callRows.push([from, callee, rel, lineOf(node), edgeKind, isDiscarded(node)]);
                }
                // `ctx.fns[name]` — a target this analysis cannot name.
                if (isDynamicFns(node.expression)) {
                    const line = lineOf(node);
                    dynamic.push({ rel, line });
                    // Recorded as a real edge to an unnamable target, so a query
                    // can see the graph has a hole here instead of reading the
                    // silence as "nothing is called".
                    callRows.push([from, "(dynamic)", rel, line, "dynamic", false]);
                }
            }

            // `types.<mod>.<Name>` in a type position — these are the global type
            // aliases genTypes writes, so they appear as qualified names.
            if (ts.isQualifiedName(node) || ts.isPropertyAccessExpression(node)) {
                const m = /^types\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(node.getText(sf));
                if (m) callRows.push([from, `types.${m[1]}.${m[2]}`, rel, lineOf(node), edgeKind === "test" ? "test" : "type", false]);
            }

            // String dispatch is the one thing that genuinely lives in a string:
            // `{ method: 'agent.modelPicker' }` in a popup descriptor, and
            // `hx-popup="ui.popupDemo"` inside the HTML a function returns. The
            // htmx layer resolves these against the registry at request time, so
            // they are real edges — missing them made half the UI look dead.
            //
            // Two shapes, because the AST sees them differently: a property value
            // is its own node, while an HTML attribute is just characters in a
            // template. Only these keys count — reading every dotted-looking
            // string as an edge is how the previous version invented 32 of them
            // out of Chrome DevTools Protocol command names.
            if (ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node.parent)) {
                if (STRING_TARGET.test(node.text) && stringDispatchContext(node, sf) && node.text !== from) {
                    callRows.push([from, node.text, rel, lineOf(node), edgeKind === "test" ? "test" : "string", false]);
                }
            }
            if (ts.isTemplateLiteralToken(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
                for (const target of htmlDispatchTargets(node.text)) {
                    if (target !== from) callRows.push([from, target, rel, lineOf(node), edgeKind === "test" ? "test" : "string", false]);
                }
            }

            ts.forEachChild(node, visit);
        };
        visit(sf);
    };

    for (const e of files) {
        const text = await Bun.file(e.abs).text();
        // A runtime fn is addressed by its dotted name; an entry point has no
        // callable name, so it is keyed by its path — still unique, still
        // greppable, and visibly not a function.
        const name = nameOf(e);

        fnRows.push([name, e.kind, e.projectRel, e.root, ENTRY.has(e.kind) || promptNames.has(name), now, tierByRoot[e.root] ?? "core", isAsyncFile(text)]);
        scanCalls(text, name, e.projectRel, e.kind);
        // The file is open and parsed anyway, so the per-file rules ride along.
        // Checking the tree separately would mean parsing all 1315 files again
        // for every report; here the whole project stays checked for free.
        for (const f of ctx.fns.code.rules({ text, rel: e.projectRel })) {
            findingRows.push([e.projectRel, f.line, f.rule, f.severity, f.detail, e.root, now]);
        }
    }

    // Test files produce edges but no node: a test is not something the runtime
    // can call, so it must never appear in code_functions as a candidate.
    for (const e of testFiles) {
        const text = await Bun.file(e.abs).text();
        scanCalls(text, e.projectRel, e.projectRel, "test");
    }

    if (!opts?.dryRun) {
        // One transaction for the whole rebuild: a half-written graph answers
        // questions wrongly and silently, which is worse than not answering.
        // Bun's pool refuses a bare BEGIN, so the unit of work goes through
        // sql.begin, which pins it to a single reserved connection.
        const sql = await ctx.fns.procs.db.conn();
        const toPg = (text: string) => ctx.fns.procs.db.toPg({ sql: text });

        // What this rebuild is responsible for, and therefore what it may
        // delete. A single file replaces only its own rows; a root replaces the
        // root's; no scope means the whole graph.
        let scope = "";
        let scopeP: unknown[] = [];
        let deleteCalls = "DELETE FROM code_calls";
        if (opts?.rel) {
            scope = " WHERE rel = ?";
            scopeP = [opts.rel];
            deleteCalls = "DELETE FROM code_calls WHERE rel = ?";
        } else if (opts?.root) {
            scope = " WHERE root = ?";
            scopeP = [opts.root];
            deleteCalls = "DELETE FROM code_calls WHERE rel IN (SELECT rel FROM code_functions WHERE root = ?)";
        }

        await sql.begin(async (tx: SqlTx) => {
            await tx.unsafe(toPg(deleteCalls), scopeP);
            await tx.unsafe(toPg("DELETE FROM code_functions" + scope), scopeP);
            await tx.unsafe(toPg("DELETE FROM code_types" + scope), scopeP);
            await tx.unsafe(toPg("DELETE FROM code_findings" + scope), scopeP);
            await bulk(tx, toPg, "code_functions", ["name", "kind", "rel", "root", "entry_point", "indexed_at", "tier", "is_async"], fnRows);
            await bulk(tx, toPg, "code_types", ["name", "rel", "root", "indexed_at"], typeRows);
            await bulk(tx, toPg, "code_calls", ["caller", "callee", "rel", "line", "kind", "discarded"], callRows);
            await bulk(tx, toPg, "code_findings", ["rel", "line", "rule", "severity", "detail", "root", "indexed_at"], findingRows);
        });
    }

    // The same callee twice on one line is one edge, not two: the primary key
    // collapses them. Report the number that will be in the table, so a caller
    // comparing the count against `SELECT count(*)` is not sent hunting for a
    // bug that is not there.
    const distinct = new Set(callRows.map(r => `${r[0]}\u0000${r[1]}\u0000${r[2]}\u0000${r[3]}`)).size;

    // An edge pointing at nothing we know is a plugin that is not mounted, or a
    // typo. Test edges are excluded: a test legitimately names fixtures that
    // exist only inside its own temporary project, and counting those would
    // bury the real signal under noise the suite creates on purpose.
    const IGNORED_FOR_RESOLUTION = new Set(["type", "dynamic", "string", "test"]);
    const unresolved = callRows.filter(r => !IGNORED_FOR_RESOLUTION.has(r[4] as string) && !allNames.has(r[1] as string)).length;

    return { functions: fnRows.length, types: typeRows.length, calls: distinct, unresolved, dynamic, ms: Date.now() - started };
}

// The dotted runtime name a call expression targets, or null if it is not a
// `ctx.fns` call at all. The chain is read right-to-left and anchored on the
// `fns` hop rather than on what precedes it, because all of these are the same
// edge: `ctx.fns.a.b()`, `(ctx as any).fns.a.b()`, a destructured `fns.a.b()`,
// and `(globalThis as any).ctx.fns.a.b()` as the tests write it.
function callTarget(node: ts.CallExpression, sf: ts.SourceFile): string | null {
    const parts: string[] = [];
    let cur: ts.Node = node.expression;
    while (ts.isPropertyAccessExpression(cur)) {
        parts.unshift(cur.name.getText(sf));
        cur = stripParens(cur.expression);
    }
    // `fns` as the root identifier: a destructured `const { fns } = ctx`.
    if (ts.isIdentifier(cur) && cur.text === "fns") {
        return parts.length >= 2 ? parts.join(".") : null;
    }
    // Otherwise `fns` has to appear as one of the hops; everything before it is
    // whatever expression happens to hold the context.
    const at = parts.indexOf("fns");
    if (at === -1) return null;
    const rest = parts.slice(at + 1);
    return rest.length >= 2 ? rest.join(".") : null;
}

// `ctx.fns[name](…)` or `fns[name](…)` — a call whose target is computed, and
// therefore unnamable by any static analysis.
function isDynamicFns(expr: ts.Node): boolean {
    if (!ts.isElementAccessExpression(expr)) return false;
    const obj = stripParens(expr.expression);
    if (ts.isIdentifier(obj)) return obj.text === "fns";
    return ts.isPropertyAccessExpression(obj) && obj.name.text === "fns";
}

// Is this string literal being used as a dispatch target, rather than being
// ordinary text that happens to look like a dotted name? Only the attribute and
// property names the htmx layer actually resolves count — everything else is
// prose, and treating prose as an edge is how the regex version invented 32 of
// them from Chrome DevTools Protocol command names.
const DISPATCH_KEYS = /^(hx-popup|hx-post|hx-get|data-fn|method|action|fn)$/i;

function stringDispatchContext(node: ts.StringLiteralLike, sf: ts.SourceFile): boolean {
    const parent = node.parent;
    // `{ method: "agent.modelPicker" }`
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
        return DISPATCH_KEYS.test(parent.name.getText(sf).replace(/["']/g, ""));
    }
    // `hx-popup="agent.modelPicker"` as a real JSX attribute
    if (ts.isJsxAttribute(parent)) return DISPATCH_KEYS.test(parent.name.getText(sf));
    return false;
}

// Dispatch targets inside the HTML a function returns as a template literal.
// Here the attribute is plain text to the parser, so this is the one place a
// regex is still the right tool — it reads characters that are characters.
function htmlDispatchTargets(text: string): string[] {
    const out: string[] = [];
    const re = /(?:hx-popup|hx-post|hx-get|data-fn|action)\s*=\s*["']([a-z][\w$]*(?:\.[\w$]+)+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) if (m[1]) out.push(m[1]);
    return out;
}

// Does this file's default export return a promise? Stored per function so that
// "nobody awaited this call" becomes a JOIN instead of a second pass over the
// tree. Eight of the ten floating calls a naive text scan reported turned out to
// be sync functions, where there is no promise to forget.
// Is this call's result thrown away? True when the call is the entire statement
// and nothing upstream consumes it. `void ctx.fns.x.y()` reads as deliberate and
// is left alone, as is anything inside an expression.
function isDiscarded(node: ts.CallExpression): boolean {
    let cur: ts.Node = node;
    // Climb out of `a.b()` chains and non-null assertions to find the statement.
    while (cur.parent && (ts.isPropertyAccessExpression(cur.parent) || ts.isCallExpression(cur.parent)
        || ts.isNonNullExpression(cur.parent) || ts.isParenthesizedExpression(cur.parent))) {
        // `foo().catch(...)` and `foo().then(...)` handle the result themselves.
        if (ts.isPropertyAccessExpression(cur.parent) && /^(then|catch|finally)$/.test(cur.parent.name.text)) return false;
        cur = cur.parent;
    }
    const parent = cur.parent;
    if (!parent) return false;
    if (ts.isAwaitExpression(parent) || ts.isReturnStatement(parent)) return false;
    if (ts.isVoidExpression(parent)) return false;                 // `void fn()` says "I know"
    return ts.isExpressionStatement(parent);
}

function isAsyncFile(text: string): boolean {
    const head = text.split("\n").find(l => l.includes("export default")) ?? "";
    return /\basync\b/.test(head) || /Promise</.test(head) || /:\s*Promise</.test(text.slice(0, 2000));
}

function stripParens(node: ts.Node): ts.Node {
    let cur = node;
    while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
    return cur;
}

// Names the system prompt hands to the model, plus the tool declarations it
// can invoke: the agent-facing API surface. A `$tool_respondHtml.md` file means
// the model calls `respondHtml` by name, and `$setting_*`/prompt prose name
// functions in text. Derived from files rather than hardcoded, so it cannot
// drift away from what the runtime actually exposes.
async function agentFacingNames(ctx: Context, entries: ScanEntry[]): Promise<Set<string>> {
    const names = new Set<string>();

    for (const e of entries) {
        const tool = /^\$tool_(.+)\.(md|ts)$/.exec(e.fileName ?? "");
        if (!tool) continue;
        const bare = tool[1]!;
        names.add(bare);
        if (e.module) names.add(`${e.module.replaceAll("/", ".")}.${bare}`);
    }

    const prompts = entries.filter(e => String(e.abs).endsWith("SYSTEM_PROMPT_CORE.txt"));
    for (const p of prompts) {
        const text = await Bun.file(p.abs).text().catch(() => "");
        for (const m of text.matchAll(/ctx\.fns\.([\w$]+(?:\.[\w$]+)+)/g)) names.add(m[1]!);
        // The prompt also names functions bare, as `agent.delegate` in prose.
        for (const m of text.matchAll(/\b([a-z][\w$]*\.[a-z][\w$]*(?:\.[a-z][\w$]*)?)\s*\(/gi)) names.add(m[1]!);
    }
    return names;
}

// Which tier each scan root belongs to. `core` and `hyper` are this repository;
// everything else reports its own source, and a root the mount table does not
// know is treated as core rather than silently becoming a boundary violation.
async function tiers(ctx: Context): Promise<Record<string, string>> {
    // `.hyper/` is the project-local glue layer: small procedures the owner of
    // this checkout writes for themselves, and the one place that is SUPPOSED
    // to wire private plugins together. It is committed, but it is personal by
    // design, so it gets its own tier rather than being judged as core.
    const out: Record<string, string> = { core: "core", hyper: "local" };
    // modules.list is synchronous, so this is a plain read, not an await.
    let mods: Array<{ name: string; source?: string; self?: boolean }> = [];
    try {
        const list = ctx.fns.procs.modules.list({}) as unknown;
        const maybe = Array.isArray(list) ? list
            : (list && typeof list === "object" && Array.isArray((list as { modules?: unknown }).modules))
                ? (list as { modules: unknown[] }).modules
                : [];
        mods = maybe as Array<{ name: string; source?: string; self?: boolean }>;
    } catch { mods = []; }
    for (const m of mods) {
        if (m.self || m.name === "core" || m.name === "hyper") continue;  // the process itself
        out[m.name] = m.source ?? "core";
    }
    return out;
}

// Postgres caps a statement at 65535 bound parameters; chunk well under it.
async function bulk(tx: SqlTx, toPg: (sql: string) => string, table: string, cols: string[], rows: Row[]): Promise<void> {
    if (!rows.length) return;
    const chunk = Math.max(1, Math.floor(5000 / cols.length));
    const tuple = "(" + cols.map(() => "?").join(",") + ")";
    for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const text = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${slice.map(() => tuple).join(",")} ON CONFLICT DO NOTHING`;
        await tx.unsafe(toPg(text), slice.flat());
    }
}
