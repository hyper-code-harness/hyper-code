// Anna's Hyper is a second installation on this Mac (user anna, LaunchDaemon
// com.hyper.anna, ports 3110/3543, Postgres container hyper-db-anna). It once
// silently stayed down because another dev process grabbed its port, so the
// watchdog cron checks the real listener owner, not just an HTTP status.
/** Health check of Anna's Hyper instance on this Mac: ports 3110/3543, listener owner, Postgres container. */
/**
 * Probe Anna's separate Hyper installation and report every problem found.
 *
 * Checks that HTTP :3110 and HTTPS :3543 answer /login, that the process
 * listening on 3110 belongs to user anna (not a stray dev server), and that
 * the docker container hyper-db-anna is healthy. Use it from the hourly
 * watchdog cron or whenever the user asks whether Anna's Hyper is up.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    _opts: {} = {},
): Promise<{ ok: boolean; problems: string[]; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    const problems: string[] = [];
    // curl, not fetch: the HTTPS listener may be HTTP/2-only (HYPER_H2_HTTP1=off)
    // and Bun's fetch cannot negotiate h2, which surfaces as a bogus TLS error.
    const probe = async (url: string) => {
        const out = (await Bun.$`curl -sk --http2 -o /dev/null -w ${"%{http_code}"} --max-time 8 ${url}`.nothrow().text()).trim();
        const status = Number(out) || 0;
        checks[url] = status ? String(status) : "unreachable";
        if (![200, 303, 401].includes(status)) problems.push(`${url} ${status ? `answered ${status}` : "unreachable"}`);
    };
    await probe("http://localhost:3110/login");
    await probe("https://localhost:3543/login");
    // lsof hides another user's sockets without sudo; the process list does not.
    const pids = (await Bun.$`pgrep -u anna -f ${"bun src/[$]main.ts"}`.nothrow().text()).trim().split(/\s+/).filter(Boolean);
    checks.process = pids.length ? `anna pid ${pids.join(",")}` : "none";
    if (!pids.length) problems.push("no Hyper server process owned by user anna (LaunchDaemon com.hyper.anna down?)");
    const docker = (await Bun.$`docker inspect -f '{{.State.Health.Status}}' hyper-db-anna`.nothrow().text()).trim();
    checks.postgres = docker || "missing";
    if (docker !== "healthy") problems.push(`hyper-db-anna container is ${docker || "missing"}`);
    return { ok: problems.length === 0, problems, checks };
}
