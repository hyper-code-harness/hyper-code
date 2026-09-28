// Is this token good, and whose is it? One path for every door — the magic
// link, the pasted token, the cookie on every request — so there is a single
// place where "who is this" is decided.
//
// Two keys may answer: the workspace's own (it signed the link it printed) and,
// when configured, a manager's public key. That second one is the whole seam:
// nothing else changes when this workspace stops trusting only itself.
/**
 * Perform verify for the auth subsystem.
 * @param opts.token The token value used by the operation.
 */
export default async function (ctx: Context, _session: Session | null, opts: { token: string; allowExpired?: boolean }): Promise<{ sub: string; name: string; email?: string; role?: string; kind?: string; jti?: string; exp: number } | null> {
    const parts = opts.token.trim().split(".");
    if (parts.length !== 3) return null;
    const [head, body, signature] = parts as [string, string, string];

    let claims: any;
    try { claims = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
    if (!claims?.sub || !claims?.name) return null;                       // a session must know who it is
    // allowExpired: the signature is still checked; only expiry is skipped (used to renew a session).
    if (!opts.allowExpired && typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;

    const data = new TextEncoder().encode(`${head}.${body}`);
    const sig = Buffer.from(signature, "base64url");
    for (const key of await keys(ctx)) {
        if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data).catch(() => false)) {
            return { sub: claims.sub, name: claims.name, email: claims.email, role: claims.role, kind: claims.kind, jti: claims.jti, exp: claims.exp };
        }
    }
    return null;
}

async function keys(ctx: Context): Promise<CryptoKey[]> {
    const own = (await ctx.fns.procs.auth.keys({})).publicKey;
    const pem = ctx.fns.procs.config.resolve({ module: "procs/auth" }).publicKey;
    if (!pem) return [own];
    const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64");
    const theirs = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]).catch(() => null);
    return theirs ? [own, theirs] : [own];
}
