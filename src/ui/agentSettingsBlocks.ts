// Collecting the answers to `ui.agentSettings` is its own function for one
// reason: both the full page render and the single-section RPC redraw need the
// same blocks, and `ui.agentMetaSection` cannot fetch them itself because it is
// synchronous — it returns a string, not a promise.
//
// A handler that throws or returns something that is not a string loses its
// row. The panel is not the place to surface a plugin's failure, and a broken
// answer must not cost the user the sections around it.

/**
 * Collects the HTML blocks plugins contribute to the agent settings section
 *
 * Runs the `ui.agentSettings` extension point for one agent and returns the non-empty string answers in registration order, dropping and logging any handler that fails. Use when rendering the agent inspector: `ui.agentMetaSection` is synchronous and takes these blocks as `extraSettings`.
 * @param opts.agentId Agent whose inspector is being drawn, passed to every handler.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose inspector is being drawn, passed to every handler. */
        agentId: string;
    },
): Promise<string[]> {
    const agentId = String(opts.agentId ?? "").trim();
    if (!agentId) return [];
    const answers = await ctx.fns.procs.hooks.run({
        name: "ui.agentSettings",
        opts: { agentId },
    }).catch((error: any) => {
        ctx.fns.procs.log.warn({ event: "ui.agent-settings.failed", msg: String(error?.message ?? error), agentId });
        return [] as any[];
    });
    return (answers ?? [])
        .map((block: any) => (typeof block === "string" ? block.trim() : ""))
        .filter(Boolean);
}
