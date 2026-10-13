/** Creates the whatsapp schema: local mirror of chats, contacts and messages received by the linked device. */
const sql = `
CREATE SCHEMA IF NOT EXISTS whatsapp;
CREATE TABLE IF NOT EXISTS whatsapp.chats (
  jid text PRIMARY KEY,
  name text,
  is_group boolean NOT NULL DEFAULT false,
  unread integer,
  last_ts timestamptz,
  meta jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whatsapp.contacts (
  jid text PRIMARY KEY,
  name text,
  notify text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whatsapp.messages (
  chat_jid text NOT NULL,
  id text NOT NULL,
  from_me boolean NOT NULL DEFAULT false,
  sender text,
  push_name text,
  ts timestamptz,
  type text,
  text text,
  raw jsonb,
  PRIMARY KEY (chat_jid, id)
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_chat_ts_idx ON whatsapp.messages(chat_jid, ts DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_ts_idx ON whatsapp.messages(ts DESC);
`;
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP SCHEMA IF EXISTS whatsapp CASCADE" }); },
};
