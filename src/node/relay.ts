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
 * retry-after and rate-limit headers. Direct Claude subscription requests use
 * the shared account pool; exhausted pools return a quota 429 with reset time.
 * Chained node requests are forwarded once and never retried or counted here.
 * When llmUsage is enabled, the terminal host records one logical relay call
 * against the authenticated immediate client. Claude owns its physical attempts
 * and final account attribution; other providers are observed once here.
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
    // Features the client's request needs (compact-2026-09-04 for a `compaction` parameter or a replayed
    // compaction block) travel in anthropic-beta; the host's identity betas are merged with them, not replaced.
    const clientBeta = opts.api === "anthropic" ? String(opts.req.headers.get("anthropic-beta") ?? "").split(",").map(s => s.trim()).filter(Boolean) : [];
    const withBeta = (headers: Record<string, string>) => {
        if (!clientBeta.length) return headers;
        const own = String(headers["anthropic-beta"] ?? "").split(",").map(s => s.trim()).filter(Boolean);
        return { ...headers, "anthropic-beta": [...new Set([...own, ...clientBeta])].join(",") };
    };
    let upstream: Response;
    if (entry.via) {
        const nodeName = entry.via.replace(/^hyper\//, "");
        const node = await ctx.fns.node.get({ name: nodeName });
        if (!node) return Response.json({ error: `node ${nodeName} is not configured` }, { status: 502 });
        const token = await ctx.fns.node.token({ name: nodeName });
        upstream = await fetch(`${node.url}/${opts.api}`, { method: "POST", signal: opts.req.signal, body,
            headers: withBeta({ "content-type": "application/json", authorization: `Bearer ${token}`, "x-hyper-hops": String(auth.hops + 1), accept: opts.req.headers.get("accept") ?? "*/*" }) });
    } else {
        const send = async (): Promise<Response> => {
            const up = await ctx.fns.node.upstream({ provider: entry.provider, account: entry.account, api: opts.api, sessionId: opts.req.headers.get("session_id") ?? undefined });
            if (!up) return Response.json({ error: `${entry.provider}: no credentials on the host` }, { status: 503 });
            const init = { method: "POST", headers: withBeta(up.headers), body, signal: opts.req.signal };
            // fetchClaude observes each actual send, including quota/401 retries.
            // Observing its returned response again would double count tokens.
            if (entry.provider === "claude-code" || entry.provider === "anthropic-oauth") {
                return (await ctx.fns.llm.fetchClaude({ provider: entry.provider, account: entry.account, url: up.url, init })).response;
            }
            const submit = () => fetch(up.url, init);
            // Tiny isolated test registries may not mount the optional ledger.
            return typeof ctx.state.registry?.llmUsage?.fetch === "function"
                ? ctx.fns.llmUsage.fetch({ provider: up.provider, account: up.account, model, api: opts.api, send: submit })
                : submit();
        };
        try {
            upstream = typeof ctx.state.registry?.llmUsage?.run === "function"
                ? await ctx.fns.llmUsage.run({ operation: "relay", source: "node", clientId: auth.client.id,
                    clientName: auth.client.name, requestedModel: model, fn: send }) as Response
                : await send();
        } catch (error) {
            const failure = (error as { failure?: types.llm.FailureInfo })?.failure;
            if (failure?.provider !== "claude-pool" || failure.kind !== "usage_limit") throw error;
            const headers = new Headers({ "cache-control": "no-store" });
            if (failure.resetsAt != null) headers.set("retry-after", String(Math.max(1, Math.ceil((failure.resetsAt - Date.now()) / 1000))));
            return Response.json({ error: { type: "usage_limit_reached", message: failure.message,
                ...(failure.resetsAt != null ? { resets_at: Math.ceil(failure.resetsAt / 1000) } : {}) } }, { status: 429, headers });
        }
    }
    const out = new Headers({ "cache-control": "no-store" });
    for (const name of ["content-type", "retry-after", "request-id", "anthropic-request-id", "x-request-id"]) { const v = upstream.headers.get(name); if (v) out.set(name, v); }
    upstream.headers.forEach((v, k) => { if (/ratelimit/i.test(k)) out.set(k, v); });
    ctx.fns.procs.log.info({ event: "node.relay", client: auth.client.name, model, api: opts.api, via: entry.via ?? entry.provider, status: upstream.status, durationMs: Math.round(performance.now() - started) });
    return new Response(upstream.body, { status: upstream.status, headers: out });
}
