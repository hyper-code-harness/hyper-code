/**
 * Keeps the background receive loop running: starts inbox.loop when the inbox.enabled setting is on, this Hyper has a key and no loop
 * runs in this process; stops it when the setting is off. Called every minute by the inbox cron declaration and safe to call any time.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ running: boolean; reason: string | null }> {
    const state = ((ctx.state as any).inbox ??= {});
    const enabled = await ctx.fns.settings.get({ module: "inbox", scopeType: "global", key: "enabled" });
    if (enabled !== true && enabled !== "true") { state.running = false; return { running: false, reason: "inbox.enabled is off" }; }
    if (state.running) return { running: true, reason: null };
    const c = await ctx.fns.inbox.connection({}).catch((error: any) => ({ error: String(error?.message ?? error) }));
    if (!c) return { running: false, reason: "no inbox key — run inbox.register" };
    if ("error" in c) return { running: false, reason: c.error };
    state.running = true;
    state.loop = ctx.fns.inbox.loop({}).catch((error: any) => ctx.fns.procs.log.error({ event: "inbox.loop.crashed", msg: String(error?.stack ?? error) }))
        .finally(() => { state.running = false; });
    return { running: true, reason: null };
}
