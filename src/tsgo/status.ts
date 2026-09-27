/**
 * Reports the state of the tsgo eval typechecker: whether it is enabled, installed and running, plus check statistics.
 *
 * Use it to see which engine eval typechecking uses, why tsgo is off
 * (lastError), and how fast checks are (average/max ms, timeouts, fallbacks to
 * the in-process checker). Does not start tsgo.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{
    enabled: boolean;
    installed: boolean;
    running: boolean;
    pid: number | null;
    uptimeMs: number | null;
    rssMb: number | null;
    checks: number;
    avgMs: number | null;
    maxMs: number;
    timeouts: number;
    fallbacks: number;
    lastError: string | null;
}> {
    const st = ((ctx.state as any).tsgo ??= {}) as types.tsgo.State;
    const enabled = (await ctx.fns.settings.get({ module: "tsgo", scopeType: "global", key: "enabled" })) !== false;
    const client = st.client?.alive ? st.client : null;
    let rssMb: number | null = null;
    if (client) {
        const p = Bun.spawn({ cmd: ["ps", "-o", "rss=", "-p", String(client.pid)], stdout: "pipe", stderr: "ignore" });
        const kb = Number((await new Response(p.stdout).text()).trim());
        rssMb = Number.isFinite(kb) && kb > 0 ? Math.round(kb / 1024) : null;
    }
    const s = st.stats ?? { checks: 0, totalMs: 0, maxMs: 0, timeouts: 0, fallbacks: 0 };
    return {
        enabled,
        installed: (await ctx.fns.tsgo.bin({})) != null,
        running: !!client,
        pid: client?.pid ?? null,
        uptimeMs: client ? Date.now() - client.startedAt : null,
        rssMb,
        checks: s.checks,
        avgMs: s.checks ? Math.round(s.totalMs / s.checks) : null,
        maxMs: s.maxMs,
        timeouts: s.timeouts,
        fallbacks: s.fallbacks,
        lastError: st.lastError ?? null,
    };
}
