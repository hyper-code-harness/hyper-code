-- Extensions the working database has in public; the test Postgres needs them before any test migrates
-- (test ctxs run with search_path pg_temp, where CREATE EXTENSION would fail).
-- Order matters: pg_search depends on vector (paradedb pg18), and the whole file is sent as one batch,
-- so vector first or the batch fails and the template is built with no extensions at all.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS pg_ivm;
CREATE EXTENSION IF NOT EXISTS postgis;
