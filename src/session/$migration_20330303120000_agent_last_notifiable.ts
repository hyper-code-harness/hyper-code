const upSql = `
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_notifiable_at BIGINT;

WITH latest AS (
    SELECT agent_id, MAX(ts) AS ts
    FROM events
    WHERE (type = 'assistant' AND NULLIF(BTRIM(payload::jsonb ->> 'text'), '') IS NOT NULL)
       OR (type = 'error' AND (payload::jsonb ->> 'error') LIKE 'stopped by user%')
    GROUP BY agent_id
)
UPDATE agents a SET last_notifiable_at = latest.ts
FROM latest WHERE latest.agent_id = a.id;

DO $migration$
DECLARE schema_name text := current_schema();
BEGIN
    EXECUTE format($function$
        CREATE OR REPLACE FUNCTION %I.update_agent_last_notifiable() RETURNS trigger AS $body$
        BEGIN
            IF (NEW.type = 'assistant' AND NULLIF(BTRIM(NEW.payload::jsonb ->> 'text'), '') IS NOT NULL)
               OR (NEW.type = 'error' AND (NEW.payload::jsonb ->> 'error') LIKE 'stopped by user%%') THEN
                UPDATE agents SET last_notifiable_at = GREATEST(COALESCE(last_notifiable_at, -1), NEW.ts)
                WHERE id = NEW.agent_id;
            END IF;
            RETURN NEW;
        END;
        $body$ LANGUAGE plpgsql
    $function$, schema_name);
    DROP TRIGGER IF EXISTS events_update_agent_last_notifiable ON events;
    EXECUTE format(
        'CREATE TRIGGER events_update_agent_last_notifiable AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION %I.update_agent_last_notifiable()',
        schema_name
    );
END;
$migration$;
`;

const downSql = `
DROP TRIGGER IF EXISTS events_update_agent_last_notifiable ON events;
DROP FUNCTION IF EXISTS update_agent_last_notifiable();
ALTER TABLE agents DROP COLUMN IF EXISTS last_notifiable_at;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
