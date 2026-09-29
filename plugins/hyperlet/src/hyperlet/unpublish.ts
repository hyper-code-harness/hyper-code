/**
 * Stops publishing a service: removes it from the Hyperlet agent config; the
 * control plane drops its route within seconds. The local service keeps running.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Published service name to remove. */
    name: string;
    /** Seconds to wait for confirmation from the agent. @default 20 @minimum 0 @maximum 120 */
    wait?: number;
}): Promise<{ removed: boolean; confirmed: boolean; remaining: string[] }> {
    const cfg = await ctx.fns.hyperlet.config({});
    if (!cfg.services.some(s => s.name === opts.name)) return { removed: false, confirmed: true, remaining: cfg.services.map(s => s.name) };
    const services = cfg.services.filter(s => s.name !== opts.name);
    const { confirmed } = await ctx.fns.hyperlet.write({ services, wait: opts.wait });
    return { removed: true, confirmed, remaining: services.map(s => s.name) };
}
