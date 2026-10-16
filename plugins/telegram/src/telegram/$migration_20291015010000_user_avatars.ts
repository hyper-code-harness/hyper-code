const sql = `
CREATE TABLE IF NOT EXISTS telegram.user_avatars (
  user_id bigint PRIMARY KEY REFERENCES telegram.users(id) ON DELETE CASCADE,
  photo_id bigint,
  file_sha256 char(64) NOT NULL REFERENCES telegram.files(sha256),
  cached_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_user_avatars_hash_idx ON telegram.user_avatars(file_sha256);
`;

export default {
  up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql }); },
  down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS telegram.user_avatars" }); }
};
