import { connect } from "node:net";

/**
 * Publishes a service running on this machine to the team VPN.
 *
 * Start the service on 127.0.0.1:<port> as this OS user first. The function
 * checks the port answers, adds it to the Hyperlet agent config and waits for
 * the control plane to route https://<name>.<team>.in.hs.hyper-mesh.xyz
 * (VPN-only, real TLS). Re-publishing an existing name updates it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Service name, first DNS label: lowercase letters, digits and '-', 1–32 chars. */
    name: string;
    /** Local loopback port the service listens on. @minimum 1024 @maximum 65535 */
    port: number;
    /** Traffic policy: http (/repl blocked), hyper (Hyper private paths blocked) or git. @default "http" */
    kind?: "http" | "hyper" | "git";
    /** Upstream protocol; https accepts a self-signed certificate. @default "http" */
    scheme?: "http" | "https";
    /** Local health path checked by the agent. @default "/" */
    health?: string;
    /** Seconds to wait for confirmation from the agent. @default 20 @minimum 0 @maximum 120 */
    wait?: number;
}): Promise<{ url: string; host: string; confirmed: boolean; routed: boolean; status: string }> {
    const { name, port } = opts;
    const kind = opts.kind ?? "http", scheme = opts.scheme ?? "http", health = opts.health ?? "/";
    if (typeof name !== "string" || !/^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) throw new Error("name: lowercase letters, digits and '-', must start with a letter");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be an integer 1024–65535");
    if (!["http", "hyper", "git"].includes(kind)) throw new Error("kind: http | hyper | git");
    if (!["http", "https"].includes(scheme)) throw new Error("scheme: http | https");
    if (!/^\/[a-zA-Z0-9/_.-]{0,127}$/.test(health)) throw new Error("health must be a path like /health");
    const listening = await new Promise<boolean>(res => {
        const c = connect({ host: "127.0.0.1", port }); const t = setTimeout(() => { c.destroy(); res(false); }, 3000);
        c.on("connect", () => { clearTimeout(t); c.destroy(); res(true); }); c.on("error", () => { clearTimeout(t); res(false); });
    });
    if (!listening) throw new Error(`Nothing listens on 127.0.0.1:${port}. Start the service bound to 127.0.0.1 first.`);
    const cfg = await ctx.fns.hyperlet.config({});
    const clash = cfg.services.find(s => s.port === port && s.name !== name);
    if (clash) throw new Error(`Port ${port} is already published as '${clash.name}'`);
    const services = [...cfg.services.filter(s => s.name !== name), { name, port, scheme, kind, health }];
    const host = `${name}.${cfg.tenant}.in.${cfg.zone}`;
    const { confirmed, report } = await ctx.fns.hyperlet.write({ services, wait: opts.wait });
    const routed = !!report?.ok && (report.hosts ?? []).includes(host);
    const status = !report ? "agent did not report (is hyperlet@<user> running?)"
        : !report.ok ? `agent error: ${report.error}`
        : (report.refused ?? []).includes(name) ? `refused: 127.0.0.1:${port} is not owned by this user`
        : routed ? ((report.down ?? []).includes(name) ? "routed, but health check fails" : "routed")
        : "pending";
    return { url: `https://${host}`, host, confirmed, routed, status };
}
