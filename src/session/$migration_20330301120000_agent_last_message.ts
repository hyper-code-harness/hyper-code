const upSql = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_message_at BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_message_idx INTEGER;

WITH latest AS (
    SELECT DISTINCT ON (agent_id) agent_id, idx, ts
    FROM messages
    WHERE role IN ('user', 'assistant')
      AND COALESCE(excluded_from_cursor, 0) = 0
    ORDER BY agent_id, ts DESC, idx DESC
)
UPDATE agents a
SET last_message_at = latest.ts, last_message_idx = latest.idx
FROM latest
WHERE a.id = latest.agent_id;

DO $migration$
DECLARE schema_name text := current_schema();
BEGIN
    EXECUTE format($function$
        CREATE OR REPLACE FUNCTION %I.update_agent_last_message() RETURNS trigger AS $body$
        BEGIN
            IF NEW.role IN ('user', 'assistant') AND COALESCE(NEW.excluded_from_cursor, 0) = 0 THEN
                UPDATE agents
                SET last_message_at = NEW.ts, last_message_idx = NEW.idx
                WHERE id = NEW.agent_id
                  AND (last_message_at IS NULL OR (NEW.ts, NEW.idx) >= (last_message_at, COALESCE(last_message_idx, -1)));
            END IF;
            RETURN NEW;
        END;
        $body$ LANGUAGE plpgsql
    $function$, schema_name);

    DROP TRIGGER IF EXISTS messages_update_agent_last_message ON messages;
    EXECUTE format(
        'CREATE TRIGGER messages_update_agent_last_message AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION %I.update_agent_last_message()',
        schema_name
    );
END;
$migration$;

CREATE INDEX IF NOT EXISTS idx_agents_nav_last_message
ON agents(last_message_at DESC NULLS LAST, id)
WHERE archived_at IS NULL AND visibility = 'nav';

CREATE INDEX IF NOT EXISTS idx_agents_nav_search_trgm
ON agents USING gin ((lower(id || ' ' || COALESCE(title, ''))) public.gin_trgm_ops)
WHERE archived_at IS NULL AND visibility = 'nav';
`;

const downSql = `
DROP INDEX IF EXISTS idx_agents_nav_search_trgm;
DROP INDEX IF EXISTS idx_agents_nav_last_message;
DROP TRIGGER IF EXISTS messages_update_agent_last_message ON messages;
DROP FUNCTION IF EXISTS update_agent_last_message();
ALTER TABLE agents DROP COLUMN IF EXISTS last_message_idx;
ALTER TABLE agents DROP COLUMN IF EXISTS last_message_at;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
