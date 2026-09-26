/**
 * Add or update a Hyper node to relay through: stores url and token, then fetches its catalogue
 * @param opts.name Local node name; becomes the model prefix hyper/<name>:.
 * @param opts.url Node base URL ending in /node/v1, e.g. http://127.0.0.1:3010/node/v1.
 * @param opts.token Client token issued by the host (node.issueClient there); empty keeps the stored one.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Local node name (model prefix hyper/<name>:). */ name: string;
    /** Node base URL ending in /node/v1. */ url: string;
    /** Client token issued by the host; empty keeps the stored one. */ token?: string;
}): Promise<types.node.NodeEntry> {
    const name = String(opts.name ?? "").trim();
    if (!/^[a-z][\w\-.]{0,31}$/i.test(name)) throw new Error("node name must be 1-32 word characters");
    const url = String(opts.url ?? "").trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(url)) throw new Error("node url must start with http:// or https://");
    const token = String(opts.token ?? "").trim();
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: `INSERT INTO llm_nodes(name, url, enabled, created_at, updated_at) VALUES (?,?,TRUE,?,?) ON CONFLICT(name) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`, params: [name, url, now, now] });
    if (token) await ctx.fns.secrets.putLocal({ namespace: "node", name: `token:${name}`, value: token, source: "node-add" });
    const node = await ctx.fns.node.refresh({ name });
    if (!node) throw new Error("node vanished");
    if (node.lastError) throw new Error(`node ${name}: ${node.lastError}`);
    return node;
}
