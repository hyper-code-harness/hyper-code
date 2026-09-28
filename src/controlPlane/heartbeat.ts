/**
 * Tells the Hyper Control Plane this instance is alive and shares a small, non-sensitive status.
 *
 * Sends counts (users, agents, running agents) and the code version; never names, messages or secrets.
 * Returns the service id the control plane knows this Hyper as, or null when not connected or unreachable.
 * Called periodically from the module's $start; safe to call by hand.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ service: string } | null> {
    const cfg = await ctx.fns.auth.oidcConfig({});
    const token = cfg ? await ctx.fns.controlPlane.token({}) : null;
    if (!cfg || !token) return null;
    const [counts] = await ctx.fns.procs.db.select({
        sql: `SELECT (SELECT count(*) FROM users WHERE disabled_at IS NULL)::int AS users,
                     (SELECT count(*) FROM agents WHERE archived_at IS NULL)::int AS agents,
                     (SELECT count(*) FROM agents WHERE run_state = 'running')::int AS running`,
    }) as any[];
    const version = String((await Bun.$`git rev-parse --short HEAD`.cwd(ctx.fns.procs.project.projectRoot({})).quiet().nothrow()).stdout).trim() || null;
    const res = await fetch(`${cfg.issuer}/services/heartbeat`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ metadata: { version, users: counts?.users ?? 0, agents: counts?.agents ?? 0, running: counts?.running ?? 0 } }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const body: any = await res.json();
    return { service: String(body.service) };
}
