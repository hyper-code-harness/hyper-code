// Findings that are a property of ONE file, written while that file is being
// parsed anyway.
//
// The alternative was a checker that re-reads the tree on demand. Measured, a
// full AST pass over 1315 files costs 211ms — fast enough to feel instant, and
// still the wrong shape: it does the same work for every question, and it cannot
// answer "what changed" without doing all of it again. The indexer already
// parses each file on every save (29ms for one file), so the parse is free and
// the report becomes a SELECT.
//
// Rows belong to a file, not to a function: `catch {}` and `String(form.get())`
// have a line but no owning runtime function, and tying them to one would be a
// lie that later queries would inherit.
//
// `is_async` on code_functions and `discarded` on code_calls are the other half.
// "This promise is never awaited" is not a property of the call site alone — it
// depends on whether the callee returns a promise at all. Eight of the ten
// floating calls a naive scan reported were sync functions, where there is
// nothing to await. With both facts stored, the question is a JOIN.
const upSql = `
CREATE TABLE IF NOT EXISTS code_findings (
    rel        TEXT    NOT NULL,
    line       INTEGER NOT NULL,
    rule       TEXT    NOT NULL,
    severity   TEXT    NOT NULL,
    detail     TEXT    NOT NULL,
    root       TEXT    NOT NULL,
    indexed_at BIGINT  NOT NULL,
    PRIMARY KEY (rel, line, rule)
);
CREATE INDEX IF NOT EXISTS code_findings_rule_idx ON code_findings(rule);
CREATE INDEX IF NOT EXISTS code_findings_root_idx ON code_findings(root);

ALTER TABLE code_functions ADD COLUMN IF NOT EXISTS is_async BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE code_calls ADD COLUMN IF NOT EXISTS discarded BOOLEAN NOT NULL DEFAULT FALSE;
`;

/** Adds code_findings (per-file rule violations written at index time), code_functions.is_async and code_calls.discarded. */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({
            sql: `DROP TABLE IF EXISTS code_findings;
                  ALTER TABLE code_functions DROP COLUMN IF EXISTS is_async;
                  ALTER TABLE code_calls DROP COLUMN IF EXISTS discarded;`,
        });
    },
};
