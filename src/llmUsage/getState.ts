/**
 * Get context-owned async accounting state without storing request payloads.
 *
 * Internal lifecycle helper. Keeps trusted scope identities and bounded write bookkeeping on this context, isolated from other runtime contexts.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<types.llmUsage.State> {
    if (ctx.state.llmUsage?.storage) return ctx.state.llmUsage;
    const { AsyncLocalStorage } = await import("node:async_hooks");
    if (ctx.state.llmUsage?.storage) return ctx.state.llmUsage;
    return ctx.state.llmUsage = { storage: new AsyncLocalStorage<types.llmUsage.Scope>(), scopes: new WeakSet(), attempts: new WeakSet(), writes: 0, enabledUntil: 0, enabled: false, checking: false };
}
