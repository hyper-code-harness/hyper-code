/**
 * Publishes an existing session as a reusable context agent
 *
 * Creates or updates a discoverable capability card for an existing agent session. Use when the session's accumulated transcript should become reusable for standard delegated tasks.
 * @param opts.agentId Existing source agent session identifier.
 * @param opts.name Human-readable registry name.
 * @param opts.description Plain-language description of the work this context agent can perform.
 * @param opts.capabilities Short task capability labels used for discovery.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Existing source agent session identifier. */
        agentId: string;
        /** Human-readable registry name. */
        name: string;
        /** Plain-language description of the work this context agent can perform. */
        description: string;
        /** Short task capability labels used for discovery. */
        capabilities: string[];
    },
): Promise<{ agentId: string; name: string; description: string; capabilities: string[]; publishedAt: number; updatedAt: number }> {
    const agentId = String(opts.agentId ?? "").trim();
    const name = String(opts.name ?? "").trim().slice(0, 120);
    const description = String(opts.description ?? "").trim().slice(0, 1000);
    const capabilities = [...new Set((opts.capabilities ?? []).map((value: string) => String(value).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    if (!agentId || !name || !description || capabilities.length === 0) throw new Error("sharedAgent.publish: agentId, name, description and capabilities are required");
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id = ? AND archived_at IS NULL", params: [agentId] }) as any[];
    if (!rows.length) throw new Error("sharedAgent.publish: agent not found: " + agentId);
    const key = "shared-agent:" + agentId;
    const previousRows = await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = ?", params: [key] }) as any[];
    let previous: any = {};
    try { previous = previousRows[0]?.value ? JSON.parse(String(previousRows[0].value)) : {}; } catch {}
    const now = Date.now();
    const card = { agentId, name, description, capabilities, publishedAt: Number(previous.publishedAt ?? now), updatedAt: now };
    await ctx.fns.procs.db.run({ sql: "INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", params: [key, JSON.stringify(card)] });
    return card;
}
