// Browsers scope cookies by host, never by port (RFC 6265 §8.5), so two Hyper
// instances on localhost:3010 and localhost:3011 would share one "procs_session"
// and sign each other out on every login. The default name therefore carries the
// listening port; an explicit AUTH_COOKIE still wins for hosts that want one
// fixed name (a reverse proxy in front of several ports, a federation peer).
/**
 * Resolve the session cookie name for this process
 *
 * Returns the configured AUTH_COOKIE when set, otherwise the default name
 * suffixed with the HTTP port so instances on different ports of one host keep
 * separate sessions. Use wherever the session cookie is written or read.
 */
export default function (ctx: Context, _session: Session | null, _opts?: {}): string {
    const auth = ctx.fns.procs.config.resolve({ module: "procs/auth" }) as { cookie: string };
    const configured = String(auth.cookie ?? "").trim();
    const explicit = String(ctx.env.AUTH_COOKIE ?? "").trim();
    if (explicit) return explicit;
    const base = configured || "procs_session";
    let port = "";
    try { port = String((ctx.fns.procs.config.resolve({ module: "procs/http" }) as { port?: number }).port ?? ""); } catch { port = ""; }
    return port ? `${base}_${port}` : base;
}
