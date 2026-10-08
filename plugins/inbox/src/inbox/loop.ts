/**
 * Internal: the background receive loop — repeated inbox.sync with a 25 s long poll while ctx.state.inbox.running is true, backing off
 * up to a minute on errors (relay down, machine off the mesh). Started by the inbox lifecycle hook when inbox.enabled is on and a key
 * exists; stopped by $stop. Returns when stopped.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<void> {
    const state = ((ctx.state as any).inbox ??= {});
    let backoff = 1000;
    while (state.running) {
        try {
            await ctx.fns.inbox.sync({ wait: 25 });
            backoff = 1000;
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "inbox.sync.failed", msg: String(error?.message ?? error) });
            await new Promise(resolve => setTimeout(resolve, backoff));
            backoff = Math.min(backoff * 2, 60_000);
        }
    }
}
