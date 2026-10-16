const sql = `
CREATE SCHEMA IF NOT EXISTS telegram;

CREATE TABLE IF NOT EXISTS telegram.sessions (
  id text PRIMARY KEY,
  self_user_id bigint,
  dc_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS telegram.users (
  id bigint PRIMARY KEY,
  access_hash bigint,
  username text,
  first_name text,
  last_name text,
  phone text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram.chats (
  id bigint PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('chat','channel')),
  access_hash bigint,
  title text,
  username text,
  megagroup boolean,
  broadcast boolean,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram.dialogs (
  session_id text NOT NULL REFERENCES telegram.sessions(id) ON DELETE CASCADE,
  peer_type text NOT NULL CHECK (peer_type IN ('user','chat','channel')),
  peer_id bigint NOT NULL,
  top_message bigint,
  read_inbox_max_id bigint,
  read_outbox_max_id bigint,
  unread_count integer NOT NULL DEFAULT 0,
  unread_mentions_count integer NOT NULL DEFAULT 0,
  folder_id integer,
  pinned boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  PRIMARY KEY (session_id, peer_type, peer_id)
);

CREATE TABLE IF NOT EXISTS telegram.messages (
  session_id text NOT NULL REFERENCES telegram.sessions(id) ON DELETE CASCADE,
  peer_type text NOT NULL CHECK (peer_type IN ('user','chat','channel')),
  peer_id bigint NOT NULL,
  id bigint NOT NULL,
  from_id_type text CHECK (from_id_type IS NULL OR from_id_type IN ('user','chat','channel')),
  from_id bigint,
  reply_to_msg_id bigint,
  grouped_id numeric(30,0),
  out boolean NOT NULL DEFAULT false,
  message text NOT NULL DEFAULT '',
  date timestamptz NOT NULL,
  edit_date timestamptz,
  deleted_at timestamptz,
  views integer,
  forwards integer,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (session_id, peer_type, peer_id, id),
  FOREIGN KEY (session_id, peer_type, peer_id)
    REFERENCES telegram.dialogs(session_id, peer_type, peer_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram.photos (
  id bigint PRIMARY KEY,
  access_hash bigint,
  file_reference bytea,
  dc_id integer,
  date timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS telegram.documents (
  id bigint PRIMARY KEY,
  access_hash bigint,
  file_reference bytea,
  mime_type text,
  size bigint,
  dc_id integer,
  date timestamptz,
  attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS telegram.message_media (
  session_id text NOT NULL,
  peer_type text NOT NULL,
  peer_id bigint NOT NULL,
  message_id bigint NOT NULL,
  position smallint NOT NULL DEFAULT 0,
  type text NOT NULL,
  photo_id bigint REFERENCES telegram.photos(id),
  document_id bigint REFERENCES telegram.documents(id),
  spoiler boolean NOT NULL DEFAULT false,
  ttl_seconds integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (session_id, peer_type, peer_id, message_id, position),
  FOREIGN KEY (session_id, peer_type, peer_id, message_id)
    REFERENCES telegram.messages(session_id, peer_type, peer_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram.files (
  sha256 char(64) PRIMARY KEY,
  storage_path text NOT NULL UNIQUE,
  size bigint NOT NULL,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS telegram.file_links (
  owner_type text NOT NULL CHECK (owner_type IN ('photo','document')),
  owner_id bigint NOT NULL,
  variant text NOT NULL DEFAULT 'original',
  file_sha256 char(64) NOT NULL REFERENCES telegram.files(sha256),
  width integer,
  height integer,
  telegram_size_type text,
  PRIMARY KEY (owner_type, owner_id, variant)
);

CREATE TABLE IF NOT EXISTS telegram.update_state (
  session_id text PRIMARY KEY REFERENCES telegram.sessions(id) ON DELETE CASCADE,
  pts integer,
  qts integer,
  seq integer,
  date timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_dialogs_recent_idx ON telegram.dialogs(session_id, top_message DESC);
CREATE INDEX IF NOT EXISTS telegram_messages_date_idx ON telegram.messages(session_id, peer_type, peer_id, date DESC);
CREATE INDEX IF NOT EXISTS telegram_messages_sender_idx ON telegram.messages(from_id_type, from_id, date DESC);
CREATE INDEX IF NOT EXISTS telegram_message_media_photo_idx ON telegram.message_media(photo_id) WHERE photo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS telegram_message_media_document_idx ON telegram.message_media(document_id) WHERE document_id IS NOT NULL;
`;

export default {
  up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql }); },
  down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: `
    DROP TABLE IF EXISTS telegram.update_state;
    DROP TABLE IF EXISTS telegram.file_links;
    DROP TABLE IF EXISTS telegram.files;
    DROP TABLE IF EXISTS telegram.message_media;
    DROP TABLE IF EXISTS telegram.documents;
    DROP TABLE IF EXISTS telegram.photos;
    DROP TABLE IF EXISTS telegram.messages;
    DROP TABLE IF EXISTS telegram.dialogs;
    DROP TABLE IF EXISTS telegram.chats;
    DROP TABLE IF EXISTS telegram.users;
    DROP TABLE IF EXISTS telegram.sessions;
  ` }); }
};
