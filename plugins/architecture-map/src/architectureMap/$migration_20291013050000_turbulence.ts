const sql = `
CREATE SCHEMA IF NOT EXISTS architecture_map;
CREATE TABLE IF NOT EXISTS architecture_map.git_repos (
  repo_dir text PRIMARY KEY,
  head_sha text NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  history_start timestamptz,
  commits integer NOT NULL DEFAULT 0,
  shallow boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS architecture_map.git_file_stats (
  repo_dir text NOT NULL REFERENCES architecture_map.git_repos(repo_dir) ON DELETE CASCADE,
  path text NOT NULL,
  commits integer NOT NULL DEFAULT 0,
  additions bigint NOT NULL DEFAULT 0,
  deletions bigint NOT NULL DEFAULT 0,
  created_sha text,
  last_commit_sha text,
  last_commit_at timestamptz,
  PRIMARY KEY(repo_dir, path)
);
CREATE INDEX IF NOT EXISTS architecture_map_git_file_stats_churn_idx ON architecture_map.git_file_stats(commits DESC, additions DESC, deletions DESC);
`;
export default {
  up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql }); },
  down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP SCHEMA IF EXISTS architecture_map CASCADE" }); },
};
