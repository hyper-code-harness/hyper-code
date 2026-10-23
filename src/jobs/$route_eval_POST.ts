// POST /jobs/eval — the door a background eval process uses to call ctx.fns. A background eval runs as its own bun
// process (tools.eval → bash job), so its `ctx.fns.x.y(opts)` is a fetch to here with { method, params }.
// Three gates, like /procs/repl: a token signed by this run (kind "eval", sub = the agent) that reached the process
// only through its self-deleting 0600 script; a loopback, non-forwarded peer; and the same project/agent access
// check as /rpc. The call runs with the agent's session, so it can do what the agent's own eval could.
const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Runs one ctx.fns call on behalf of a background eval process and answers { value } or { error }
 * @param opts.req Incoming request: Bearer eval token, JSON body { method, params }.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }): Promise<Response> {
    const req = opts.req;
    const forwarded = req.headers.get("x-forwarded-for") ?? req.headers.get("x-forwarded-host") ?? req.headers.get("forwarded");
    const ip = (ctx.state as any).procs?.http?.server?.server?.requestIP?.(req)?.address;
    if (forwarded || (ip && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip))) return Response.json({ error: "loopback only" }, { status: 403 });
    const header = req.headers.get("authorization") ?? "";
    const claims = header.startsWith("Bearer ") ? await ctx.fns.procs.auth.verify({ token: header.slice(7) }) : null;
    if (claims?.kind !== "eval") return Response.json({ error: "eval token required" }, { status: 403 });
    const agentId = claims.sub;

    let body: any;
    try { body = await req.json(); } catch { return Response.json({ error: "invalid payload" }, { status: 400 }); }
    const method = String(body?.method ?? "");
    const params = body?.params ?? {};
    const parts = method.split(".").filter(Boolean);
    if (!parts.length || parts.some((p) => BLOCKED.has(p) || !/^[A-Za-z_$][\w$-]*$/.test(p))) return Response.json({ error: `invalid method: ${method}` }, { status: 400 });
    if (!params || typeof params !== "object" || Array.isArray(params)) return Response.json({ error: "params must be an object" }, { status: 400 });

    const live = (ctx.state as any).agent?.[agentId];
    const session: any = live ? ctx.fns.session.forAgent({ agent: live }) : { kind: "agent", agentId };
    const actx: any = Object.create(ctx);
    actx.session = session;
    // The process only has a JSON snapshot of its agent; a call that takes `agent` gets the live one back.
    if (live && params.agent && typeof params.agent === "object" && params.agent.id === agentId) params.agent = live;
    let fn: any = actx.fns;
    try { for (const part of parts) fn = fn?.[part]; } catch { fn = null; }
    if (typeof fn !== "function") return Response.json({ error: `ctx.fns.${method} is not a function` }, { status: 404 });
    const access = await ctx.fns.project.canCall({ name: method, agentId });
    if (!access.allowed) return Response.json({ error: `forbidden: ${access.reason}` }, { status: 403 });
    try {
        const value = await fn(params);
        return new Response(JSON.stringify({ value: value === undefined ? null : value }), { headers: { "content-type": "application/json" } });
    } catch (error: any) {
        return Response.json({ error: String(error?.message ?? error) }, { status: 400 });
    }
}
