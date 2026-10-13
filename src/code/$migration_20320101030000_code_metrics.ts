const upSql = `
CREATE TABLE IF NOT EXISTS code_file_metrics (
    rel                  TEXT PRIMARY KEY,
    root                 TEXT NOT NULL,
    language             TEXT NOT NULL,
    lines                INTEGER NOT NULL,
    source_lines         INTEGER NOT NULL,
    functions            INTEGER NOT NULL,
    cyclomatic_total     INTEGER NOT NULL,
    cyclomatic_max       INTEGER NOT NULL,
    cognitive_total      INTEGER NOT NULL,
    cognitive_max        INTEGER NOT NULL,
    nesting_max          INTEGER NOT NULL,
    parameters_max       INTEGER NOT NULL,
    indexed_at           BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS code_file_metrics_root_idx ON code_file_metrics(root);
CREATE INDEX IF NOT EXISTS code_file_metrics_cyclomatic_idx ON code_file_metrics(cyclomatic_total DESC);

CREATE TABLE IF NOT EXISTS code_function_metrics (
    rel                  TEXT NOT NULL,
    root                 TEXT NOT NULL,
    name                 TEXT NOT NULL,
    line                 INTEGER NOT NULL,
    end_line             INTEGER NOT NULL,
    lines                INTEGER NOT NULL,
    cyclomatic           INTEGER NOT NULL,
    cognitive            INTEGER NOT NULL,
    nesting_max          INTEGER NOT NULL,
    parameters           INTEGER NOT NULL,
    indexed_at           BIGINT NOT NULL,
    PRIMARY KEY (rel, line, name)
);
CREATE INDEX IF NOT EXISTS code_function_metrics_rel_idx ON code_function_metrics(rel);
CREATE INDEX IF NOT EXISTS code_function_metrics_cyclomatic_idx ON code_function_metrics(cyclomatic DESC);
`;

/** Adds cached AST-derived file and function metrics to the shared code index. */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS code_function_metrics; DROP TABLE IF EXISTS code_file_metrics;" }); },
};
