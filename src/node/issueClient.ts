/**
 * Issue a token for a client Hyper that may relay through this host; the plain token is returned once and only its hash is stored
 * @param opts.name Client label, e.g. "anna" or "macbook".
 * @param opts.providers Own providers the client may use; empty means all shareable ones.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Client label. */ name: string;
    /** Own providers the client may use; empty = all shareable. */ providers?: string[];
}): Promise<{ id: string; name: string; token: string; url: string }> {
    const name = String(opts.name ?? "").trim().slice(0, 64);
    if (!name) throw new Error("client name is required");
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    const id = Bun.randomUUIDv7();
    await ctx.fns.procs.db.insert({ into: "llm_node_clients", values: { id, name, token_hash: hash, token_hint: `${token.slice(0, 4)}…${token.slice(-4)}`, providers: (opts.providers ?? []).join(","), created_at: Date.now(), requests: 0 } });
    const port = (ctx.fns.procs.config.resolve({ module: "procs/http" }) as { port?: number }).port ?? 3010;
    ctx.fns.procs.events.refresh({ topic: "node-clients", reason: "issued" });
    return { id, name, token, url: `http://127.0.0.1:${port}/node/v1` };
}
