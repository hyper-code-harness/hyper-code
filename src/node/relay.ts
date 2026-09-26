// One relay for the three wire formats. The body is the client's own provider
// request; we look the model up in the catalogue the client is entitled to,
// swap in our credential (node.upstream) or forward to one of our own nodes
// (chaining), and stream the answer back untouched together with the headers
// the client's classifyError needs.
/**
 * Relay one provider request from a node client through this host's credentials or a chained node
 *
 * Authorizes the request, maps body.model to an entitled catalogue entry,
 * forwards the untouched body upstream with the host's credential and
 * identity headers (or to the next node with the hop counter incremented) and
 * returns the upstream response 1:1 including streaming body, status,
 * retry-after and rate-limit headers.
 * @param opts.req Incoming client request with the provider JSON body.
 * @param opts.api Wire api named by the route.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming client request. */
        req: Request;
        /** Wire api named by the route. */
        api: "anthropic" | "responses" | "openai";
    },
): Promise<Response> {
    const auth = await ctx.fns.node.authorize({ req: opts.req });
    if (!auth.ok) return auth.response;
    const body = await opts.req.text();
    let model = "";
    try { model = String(JSON.parse(body)?.model ?? ""); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
    if (!model) return Response.json({ error: "body.model is required" }, { status: 400 });
    const catalog = await ctx.fns.node.catalog({ providers: auth.client.providers, excludeNode: auth.client.name, hops: auth.hops });
    const entry = catalog.find((e) => e.id === model && e.api === opts.api);
    if (!entry) return Response.json({ error: `model not offered to this client: ${model} (${opts.api})` }, { status: 404 });
    const started = performance.now();
    let upstream: Response;
    if (entry.via) {
        const nodeName = entry.via.replace(/^hyper\//, "");
        const node = await ctx.fns.node.get({ name: nodeName });
        if (!node) return Response.json({ error: `node ${nodeName} is not configured` }, { status: 502 });
        const token = await ctx.fns.node.token({ name: nodeName });
        upstream = await fetch(`${node.url}/${opts.api}`, { method: "POST", signal: opts.req.signal, body,
            headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-hyper-hops": String(auth.hops + 1), accept: opts.req.headers.get("accept") ?? "*/*" } });
    } else {
        const up = await ctx.fns.node.upstream({ provider: entry.provider, account: entry.account, api: opts.api, sessionId: opts.req.headers.get("session_id") ?? undefined });
        if (!up) return Response.json({ error: `${entry.provider}: no credentials on the host` }, { status: 503 });
        upstream = await fetch(up.url, { method: "POST", headers: up.headers, body, signal: opts.req.signal });
    }
    const out = new Headers({ "cache-control": "no-store" });
    for (const name of ["content-type", "retry-after", "request-id", "anthropic-request-id", "x-request-id"]) { const v = upstream.headers.get(name); if (v) out.set(name, v); }
    upstream.headers.forEach((v, k) => { if (/ratelimit/i.test(k)) out.set(k, v); });
    ctx.fns.procs.log.info({ event: "node.relay", client: auth.client.name, model, api: opts.api, via: entry.via ?? entry.provider, status: upstream.status, durationMs: Math.round(performance.now() - started) });
    return new Response(upstream.body, { status: upstream.status, headers: out });
}
