// Reads one chat input row. JSONB arrives parsed from Postgres but as text from
// some drivers and test databases, so both shapes are normalised here once.
/**
 * Reads a chat input (secret, confirm, choice, grid…) by id with its current state, spec and result.
 * Use to check whether the person has answered an input opened with input.request.
 * @param opts.id Input identifier returned by input.request.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Input identifier returned by input.request. */
    id: string;
}): Promise<types.input.Row | null> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT * FROM inputs WHERE id = ?", params: [String(opts.id ?? "")] });
    const r = rows[0];
    if (!r) return null;
    const json = (v: any) => (typeof v === "string" ? JSON.parse(v) : v ?? null);
    return {
        id: r.id, agentId: r.agent_id, kind: r.kind, state: r.state, title: r.title, message: r.message,
        spec: json(r.spec) ?? {}, result: json(r.result), error: r.error ?? null, answeredBy: r.answered_by ?? null,
        createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
}
