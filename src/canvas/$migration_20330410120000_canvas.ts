// Canvas: a large work surface left of the chat. Per agent: whether it is open, how wide the chat
// column is beside it, and (from the next step on) the items open in it as tabs. Additive.
//
// canvas_items is created now so later kinds (file, image, url, plugin documents, diagrams…) add rows,
// not schema: kind is a namespaced id answered by a canvas.kind.<kind> hook, payload is that kind's
// JSON with its own version. An empty canvas is an open canvas with no items.
const upSql = `
CREATE TABLE IF NOT EXISTS canvas_state (
    agent_id TEXT PRIMARY KEY,
    open BOOLEAN NOT NULL DEFAULT false,
    chat_width INTEGER,
    active_item_id BIGINT,
    updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS canvas_items (
    id BIGSERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS canvas_items_agent_idx ON canvas_items (agent_id, position, id);
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS canvas_items; DROP TABLE IF EXISTS canvas_state" }); },
};
