/**
 * Voice control panel for one agent: live local whisper transcription plus the dry-run dispatcher, bound to the agent
 * that opened it. Plain dictation is addressed to that agent (`agentId`) until the person switches by voice.
 *
 * Use from an agent to put voice control on its canvas: `canvas.show({ fn: "whisper.voice", params: { agentId: agent.id } })`.
 * The agent id is required so spoken questions are routed back to the agent that owns the panel.
 * @view
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Id of the agent that opens the panel; it receives dictation and questions. */
    agentId: string;
}): Promise<string> {
    const id = String(opts.agentId ?? "").trim();
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error(`whisper.voice: agentId is required, got ${JSON.stringify(opts.agentId)}`);
    const list: any = await ctx.fns.session.list({});
    if (!(Array.isArray(list) ? list : []).some((s: any) => s.id === id)) throw new Error(`whisper.voice: agent not found: ${id}`);
    return ctx.fns.rpc.frame({ src: `/whisper?embed=1&agent=${encodeURIComponent(id)}`, title: "Voice control" });
}
