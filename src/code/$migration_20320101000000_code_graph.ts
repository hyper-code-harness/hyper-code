// The call graph of this codebase, as three tables: nodes that are functions,
// nodes that are types, and the edges between them.
//
// Names are prefixed `code_` rather than living in a `code` schema on purpose:
// the test harness isolates each ctx by pinning search_path to pg_temp, which
// only captures UNQUALIFIED SQL. A schema-qualified table would escape that
// sandbox and hit the shared database from every test run.
const upSql = `
CREATE TABLE IF NOT EXISTS code_functions (
    name        TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    rel         TEXT NOT NULL,
    root        TEXT NOT NULL DEFAULT 'core',
    entry_point BOOLEAN NOT NULL DEFAULT FALSE,
    indexed_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS code_functions_rel_idx  ON code_functions(rel);
CREATE INDEX IF NOT EXISTS code_functions_kind_idx ON code_functions(kind);

CREATE TABLE IF NOT EXISTS code_types (
    name       TEXT PRIMARY KEY,
    rel        TEXT NOT NULL,
    root       TEXT NOT NULL DEFAULT 'core',
    indexed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS code_types_rel_idx ON code_types(rel);

-- One row per call site, so line numbers survive: "who calls X" must be able to
-- answer "in these files, on these lines", not merely "somewhere".
CREATE TABLE IF NOT EXISTS code_calls (
    caller  TEXT    NOT NULL,
    callee  TEXT    NOT NULL,
    rel     TEXT    NOT NULL,
    line    INTEGER NOT NULL,
    kind    TEXT    NOT NULL DEFAULT 'fn',
    PRIMARY KEY (caller, callee, rel, line)
);
CREATE INDEX IF NOT EXISTS code_calls_callee_idx ON code_calls(callee);
CREATE INDEX IF NOT EXISTS code_calls_caller_idx ON code_calls(caller);
`;

/** Creates the call-graph tables: code_functions, code_types and code_calls. */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS code_calls; DROP TABLE IF EXISTS code_types; DROP TABLE IF EXISTS code_functions;" });
    },
};
