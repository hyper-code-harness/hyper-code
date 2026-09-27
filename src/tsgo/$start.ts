// Warm tsgo in the background at boot so the first eval does not pay the
// ~0.3–1 s project load. Never blocks or fails boot: tsgo is optional.
/** Starts the tsgo language server in the background when eval typechecking via tsgo is enabled. */
export default async function (ctx: Context, _session: Session | null, _config?: unknown): Promise<void> {
    queueMicrotask(async () => {
        try {
            const enabled = await ctx.fns.settings.get({ module: "tsgo", scopeType: "global", key: "enabled" });
            if (enabled === false) return;
            await ctx.fns.tsgo.check({ code: "return 0", timeoutMs: 30_000 });
        } catch (e: any) {
            ctx.fns.procs.log.warn({ event: "tsgo.warmup.failed", msg: String(e?.message ?? e) });
        }
    });
}
