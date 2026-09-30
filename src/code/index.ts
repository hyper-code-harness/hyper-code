// Rebuild the call graph from source text.
//
// Why a regex and not a TypeScript AST: cross-imports between project files are
// forbidden here, so EVERY edge between two runtime functions has to be a
// literal `ctx.fns.<ns>.<fn>(` in the text. The call graph is already explicit
// in the source; parsing would cost seconds and buy nothing. The one thing a
// regex cannot see — a dynamic `ctx.fns[name]` dispatch — is counted and
// returned, so the blind spot is reported rather than hidden.

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
    const entries = (await ctx.fns.procs.project.scan({})) as any[];
    const now = Date.now();

    // Entry points are called by the framework, never from code: a route is hit
    // over HTTP, a cron by the scheduler, a tool by the model. They have zero
    // in-edges by nature and must never be mistaken for dead code.
    const ENTRY = new Set(["route", "cron", "tool", "lifecycle", "app", "middleware", "compaction", "gap", "point", "hook"]);
    const wanted = (e: any) => (e.kind === "fn" || ENTRY.has(e.kind)) && e.abs.endsWith(".ts") && !e.abs.endsWith(".test.ts");

    // A third kind of entry point, invisible in the call graph: functions the
    // system prompt teaches the model to call. `agent.delegate` has no caller
    // in the source and is used constantly. Without this the dead-code list
    // opens with the agent's own API and nobody believes the rest of it.
    const promptNames = await agentFacingNames(ctx, entries);

    const inScope = (e: any) => (!opts?.root || e.root === opts.root) && (!opts?.rel || e.projectRel === opts.rel);
    const files = entries.filter(e => wanted(e) && inScope(e));
    const typeFiles = entries.filter(e => e.kind === "type" && inScope(e));
    // Tests are not part of the registry, but a call from a test IS a call — it
    // is just a different kind of one. Recording them as `test` edges is what
    // lets dead-code reporting separate "nothing calls this" from "only its own
    // test calls this", which are different diagnoses with different fixes.
    const testFiles = entries.filter(e => e.abs.endsWith(".test.ts") && inScope(e));

    const fnRows: any[][] = [];
    const typeRows: any[][] = [];
    const callRows: any[][] = [];
    const dynamic: Array<{ rel: string; line: number }> = [];

    // The dotted name a file answers to. Computed without reading anything, so
    // it can be done for the whole tree before any call is resolved.
    const nameOf = (e: any) => e.kind === "fn"
        ? (e.moduleDir === "." ? e.runtimeName : `${e.moduleDir.replaceAll("/", ".")}.${e.runtimeName}`)
        : e.projectRel;

    // Every name the registry has, not just the ones in scope: resolving a call
    // needs the whole picture even when only one file is being re-indexed.
    const allNames = new Set<string>(entries.filter(wanted).map(nameOf));

    for (const e of typeFiles) {
        // Mirrors genTypes: src/<mod>/<Name>.ts is referred to as types.<mod>.<Name>.
        const stem = e.fileName.replace(/^\$type_/, "").replace(/\.ts$/, "");
        const name = (e.module ? `${e.module.replaceAll("/", ".")}.` : "") + stem;
        typeRows.push([name, e.projectRel, e.root, now]);
    }

    // `ctx.fns.a.b(` is the normal form, but a cast writes `(ctx as any).fns.a.b(`
    // and a destructured `const { fns } = ctx` writes `fns.a.b(`. All three are
    // the same edge, so the prefix before `fns.` is optional.
    const CALL = /(?<![\w$])fns\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\(/g;
    const TYPE = /\btypes\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
    // String dispatch from the UI layer: hx-popup="agent.modelPicker",
    // method: 'agent.effortPicker', action="session.rename". These are real
    // edges — the htmx layer resolves the string against the registry at
    // request time — and missing them made half the UI look like dead code.
    const STRING_CALL = /(?:hx-popup|hx-post|hx-get|data-fn|method|action|fn)\s*[=:]\s*["'`]([a-z][\w$]*(?:\.[\w$]+)+)["'`]/gi;
    const DYNAMIC = /(?:ctx\.)?fns\s*\[/g;

    // One reader for both kinds of file. A second copy of "what counts as a
    // call" would drift from this one within a week.
    const scanCalls = (text: string, from: string, rel: string, edgeKind: string) => {
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.trimStart().startsWith("//")) continue; // a mention in a comment is not a call

            CALL.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = CALL.exec(line)) !== null) {
                // Two segments or three? `runtime.docs.search` is a nested
                // module and `procs.db.select` is too, while `shop.charge(…)`
                // followed by `.then` is not. Ask the registry instead of
                // hardcoding which prefixes are allowed to nest: the three-part
                // name wins only if such a function actually exists.
                const two = `${m[1]}.${m[2]}`;
                const three = m[3] ? `${two}.${m[3]}` : null;
                const callee = three && allNames.has(three) ? three : two;
                if (callee !== from) callRows.push([from, callee, rel, i + 1, edgeKind]);
            }

            TYPE.lastIndex = 0;
            while ((m = TYPE.exec(line)) !== null) {
                callRows.push([from, `types.${m[1]}.${m[2]}`, rel, i + 1, edgeKind === "test" ? "test" : "type"]);
            }

            STRING_CALL.lastIndex = 0;
            while ((m = STRING_CALL.exec(line)) !== null) {
                const callee = m[1]!;
                if (callee !== from) callRows.push([from, callee, rel, i + 1, edgeKind === "test" ? "test" : "string"]);
            }

            DYNAMIC.lastIndex = 0;
            if (DYNAMIC.test(line)) {
                dynamic.push({ rel, line: i + 1 });
                // Recorded as a real edge to an unnamable target, so that a
                // query can see the graph has a hole here instead of reading
                // the silence as "nothing is called".
                callRows.push([from, "(dynamic)", rel, i + 1, "dynamic"]);
            }
        }
    };

    for (const e of files) {
        const text = await Bun.file(e.abs).text();
        // A runtime fn is addressed by its dotted name; an entry point has no
        // callable name, so it is keyed by its path — still unique, still
        // greppable, and visibly not a function.
        const name = nameOf(e);

        fnRows.push([name, e.kind, e.projectRel, e.root, ENTRY.has(e.kind) || promptNames.has(name), now]);
        scanCalls(text, name, e.projectRel, e.kind);
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
        let scopeP: any[] = [];
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

        await sql.begin(async (tx: any) => {
            await tx.unsafe(toPg(deleteCalls), scopeP);
            await tx.unsafe(toPg("DELETE FROM code_functions" + scope), scopeP);
            await tx.unsafe(toPg("DELETE FROM code_types" + scope), scopeP);
            await bulk(tx, toPg, "code_functions", ["name", "kind", "rel", "root", "entry_point", "indexed_at"], fnRows);
            await bulk(tx, toPg, "code_types", ["name", "rel", "root", "indexed_at"], typeRows);
            await bulk(tx, toPg, "code_calls", ["caller", "callee", "rel", "line", "kind"], callRows);
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

// Names the system prompt hands to the model, plus the tool declarations it
// can invoke: the agent-facing API surface. A `$tool_respondHtml.md` file means
// the model calls `respondHtml` by name, and `$setting_*`/prompt prose name
// functions in text. Derived from files rather than hardcoded, so it cannot
// drift away from what the runtime actually exposes.
async function agentFacingNames(ctx: Context, entries: any[]): Promise<Set<string>> {
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

// Postgres caps a statement at 65535 bound parameters; chunk well under it.
async function bulk(tx: any, toPg: (sql: string) => string, table: string, cols: string[], rows: any[][]): Promise<void> {
    if (!rows.length) return;
    const chunk = Math.max(1, Math.floor(5000 / cols.length));
    const tuple = "(" + cols.map(() => "?").join(",") + ")";
    for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const text = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${slice.map(() => tuple).join(",")} ON CONFLICT DO NOTHING`;
        await tx.unsafe(toPg(text), slice.flat());
    }
}
