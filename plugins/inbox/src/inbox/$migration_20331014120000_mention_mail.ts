// @mentions mailed through the inbox: one row per mention (sent or failed), so a mention is mailed at most once and a reply in the
// thread of the mail (message_id) finds its chat and person. Additive: a new table in the plugin's schema.
const upSql = `
CREATE TABLE IF NOT EXISTS inbox.mention_mail (
    mention_id bigint PRIMARY KEY,
    agent_id text NOT NULL,
    to_user text NOT NULL,
    to_addr text,
    message_id text,
    error text,
    created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_mention_mail_message_idx ON inbox.mention_mail(message_id);
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS inbox.mention_mail" }); },
};
