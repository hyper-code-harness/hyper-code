/** Stops all process-wide external attachment producers during shutdown. */
export default async function (ctx: Context, _session: Session | null, _state?: unknown) {
    await ctx.fns.agent.stopUnusedAttachments({ all: true });
}
