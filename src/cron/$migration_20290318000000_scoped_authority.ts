/** Durable owner grants are invalidated whenever a cron definition changes. */
export default {
    up: async (ctx: Context) => {
        const rows = await ctx.fns.procs.db.select({sql: "SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid='cron_tasks'::regclass"});
        const schema = '"' + String(rows[0].nspname).replaceAll('"', '""') + '"';
        await ctx.fns.procs.db.exec({sql: `
            ALTER TABLE cron_tasks ADD COLUMN IF NOT EXISTS authority_version bigint NOT NULL DEFAULT 1;
            ALTER TABLE cron_runs ADD COLUMN IF NOT EXISTS authority_version bigint;
            CREATE TABLE IF NOT EXISTS cron_grants (
                task_name text PRIMARY KEY REFERENCES cron_tasks(name) ON DELETE CASCADE,
                target_fn text NOT NULL, definition_version bigint NOT NULL,
                owner_id text NOT NULL, scopes jsonb NOT NULL, created_at bigint NOT NULL
            );
            CREATE OR REPLACE FUNCTION ${schema}.cron_definition_version() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF ROW(NEW.fn,NEW.args,NEW.schedule_type,NEW.every_ms,NEW.source,NEW.definition_hash)
                   IS DISTINCT FROM ROW(OLD.fn,OLD.args,OLD.schedule_type,OLD.every_ms,OLD.source,OLD.definition_hash) THEN
                    NEW.authority_version := OLD.authority_version + 1;
                ELSE NEW.authority_version := OLD.authority_version;
                END IF;
                RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS cron_definition_version ON cron_tasks;
            CREATE TRIGGER cron_definition_version BEFORE UPDATE ON cron_tasks
            FOR EACH ROW EXECUTE FUNCTION ${schema}.cron_definition_version();
        `});
    },
};
