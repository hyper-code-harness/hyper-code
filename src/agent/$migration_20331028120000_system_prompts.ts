// Named system prompts. The base of an agent's system prompt (what SYSTEM_PROMPT_CORE.txt used to be for
// everyone) is now chosen by name: built-in ones live next to the code (full, lean), people save their own in
// system_prompts — scope user (owner_id = user id, seen by that person's chats) or project (owner_id = project id,
// seen by the project's chats). agents.system_prompt_name records the choice of a chat ('' = full, the prompt every chat had
// before); agents.system_prompt_core is a one-off base given at creation instead of a name. Additive.
const upSql = `
CREATE TABLE IF NOT EXISTS system_prompts (
    name        TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'project')),
    owner_id    TEXT NOT NULL DEFAULT '',
    created_by  TEXT,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL,
    PRIMARY KEY (scope, owner_id, name)
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt_name TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt_core TEXT NOT NULL DEFAULT '';
`;
const downSql = `
ALTER TABLE agents DROP COLUMN IF EXISTS system_prompt_core;
ALTER TABLE agents DROP COLUMN IF EXISTS system_prompt_name;
DROP TABLE IF EXISTS system_prompts;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
