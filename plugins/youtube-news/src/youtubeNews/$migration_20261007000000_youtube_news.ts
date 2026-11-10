const sql=`
CREATE SCHEMA IF NOT EXISTS youtube_news;
CREATE TABLE IF NOT EXISTS youtube_news.channels(
  key text PRIMARY KEY,
  channel_id text NOT NULL UNIQUE,
  handle text,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS youtube_news.videos(
  channel_key text NOT NULL REFERENCES youtube_news.channels(key) ON DELETE CASCADE,
  video_id text NOT NULL,
  title text NOT NULL,
  description text,
  published_at timestamptz,
  url text NOT NULL,
  transcript text,
  transcript_source text,
  transcript_lang text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  news_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(channel_key,video_id)
);
CREATE INDEX IF NOT EXISTS youtube_news_videos_published_idx ON youtube_news.videos(channel_key,published_at DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS youtube_news.runs(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_key text NOT NULL REFERENCES youtube_news.channels(key) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  fetched integer NOT NULL DEFAULT 0,
  added integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  published integer NOT NULL DEFAULT 0,
  error text
);
`;
export default {up:async(ctx:Context)=>{await ctx.fns.procs.db.exec({sql})},down:async(ctx:Context)=>{await ctx.fns.procs.db.exec({sql:"DROP SCHEMA IF EXISTS youtube_news CASCADE"})}};
