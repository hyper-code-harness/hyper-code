/**
 * Boot-only cleanup of the two obsolete tool-result keys in agents.scratchpad.
 * Preserve all other object fields; malformed JSON and non-objects are untouched.
 * Run before agent rehydration, never against a running writer process. PostgreSQL
 * NOTICE reports changed/skipped counts without exposing scratchpad contents.
 */
export default {
    async up(ctx: Context) {
        const started = ctx.state.procs?.lifecycle?.started ?? [];
        if (started.includes("agent") || started.includes("procs/http")
            || Object.keys(ctx.state.agent ?? {}).length > 0
            || (ctx.state as { workerLoopPromise?: Promise<unknown> }).workerLoopPromise) {
            throw new Error("Legacy scratchpad cleanup is boot-only: stop all writers and run before agent loading");
        }
        // One DO statement is one atomic transaction. No JS JSON round-trip (which
        // would lose large integers), and no '?' JSON operators/placeholders.
        await ctx.fns.procs.db.exec({ sql: `
DO $cleanup$
DECLARE
    row_data RECORD;
    value JSONB;
    changed_count BIGINT := 0;
    malformed_count BIGINT := 0;
    non_object_count BIGINT := 0;
BEGIN
    FOR row_data IN SELECT id, scratchpad FROM agents FOR UPDATE LOOP
        BEGIN
            value := row_data.scratchpad::jsonb;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR untranslatable_character THEN
            malformed_count := malformed_count + 1;
            CONTINUE;
        END;
        IF value IS NULL OR jsonb_typeof(value) <> 'object' THEN
            non_object_count := non_object_count + 1;
            CONTINUE;
        END IF;
        IF jsonb_exists(value, 'results') OR jsonb_exists(value, 'resultSeq') THEN
            UPDATE agents
            SET scratchpad = (value - 'results' - 'resultSeq')::text
            WHERE id = row_data.id;
            changed_count := changed_count + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'legacy scratchpad cleanup: changed=%, malformed=%, non_object=%',
        changed_count, malformed_count, non_object_count;
END
$cleanup$;
` });
    },
};
