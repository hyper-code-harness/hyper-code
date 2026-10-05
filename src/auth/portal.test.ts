import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// Portal trust: the hypermesh hub adds X-Hn-Assertion, a short JWT signed with the control plane's
// OIDC keys. A local fake issuer serves discovery + JWKS with one RSA and one EC key.
const AUD = "hn:hr/studio/hyper";
let server: ReturnType<typeof Bun.serve>;
let issuer = "";
let rsa: CryptoKeyPair;
let ec: CryptoKeyPair;
let attacker: CryptoKeyPair;

beforeAll(async () => {
    rsa = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    attacker = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const keys = [
        { ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)), kid: "rsa1", alg: "RS256", use: "sig" },
        { ...(await crypto.subtle.exportKey("jwk", ec.publicKey)), kid: "ec1", alg: "ES256", use: "sig" },
    ];
    server = Bun.serve({
        port: 0,
        fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/.well-known/openid-configuration") return Response.json({ issuer, jwks_uri: `${issuer}/jwks` });
            if (path === "/jwks") return Response.json({ keys });
            return new Response("no", { status: 404 });
        },
    });
    issuer = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server?.stop(true));

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
async function sign(claims: Record<string, unknown>, opts: { alg?: "RS256" | "ES256"; key?: CryptoKey; kid?: string } = {}) {
    const alg = opts.alg ?? "RS256";
    const head = b64({ alg, typ: "JWT", kid: opts.kid ?? (alg === "ES256" ? "ec1" : "rsa1") });
    const now = Math.floor(Date.now() / 1000);
    const body = b64({ iss: issuer, aud: AUD, sub: "p-anna", email: "anna@health-samurai.io", name: "Anna", iat: now, exp: now + 60, hn_device: "dev-1", ...claims });
    const key = opts.key ?? (alg === "ES256" ? ec.privateKey : rsa.privateKey);
    const algorithm = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
    const sig = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

async function hyper(env: Record<string, string> = {}) {
    const ctx = await mkTestCtx({ env: { HYPER_PORTAL_TRUST: "true", HYPER_PORTAL_AUDIENCE: AUD, HYPER_PORTAL_ISSUER: issuer, ...env } });
    // An owner with a password, so the instance requires sign-in like a real deployment.
    await ctx.fns.auth.createUser({ name: "Nik", email: "niquola@health-samurai.io", password: "password-123" });
    return ctx;
}
const req = (assertion?: string, extra: Record<string, string> = {}) =>
    new Request("https://hyper.example/agent/ab", { headers: { accept: "text/html", ...(assertion ? { "x-hn-assertion": assertion } : {}), ...extra } });

test("valid RS256 assertion signs in and auto-creates a member", async () => {
    const ctx = await hyper();
    const who = await ctx.fns.auth.currentUser({ req: req(await sign({})) });
    expect(who.user?.email).toBe("anna@health-samurai.io");
    expect(who.user?.role).toBe("member");
    expect(who.required).toBe(true);
    const page = await ctx.fns.procs.http.dispatch({ method: "GET", url: "https://hyper.example/auth/session", headers: { "x-hn-assertion": await sign({}) } });
    expect(page.status).not.toBe(303);
});

test("ES256 assertion is accepted; the same person maps to the same user", async () => {
    const ctx = await hyper();
    const a = await ctx.fns.auth.currentUser({ req: req(await sign({})) });
    const b = await ctx.fns.auth.currentUser({ req: req(await sign({ iat: Math.floor(Date.now() / 1000) - 1 }, { alg: "ES256" })) });
    expect(b.user?.id).toBe(a.user?.id);
});

test("first portal user on an empty Hyper is a member, never the owner", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PORTAL_TRUST: "true", HYPER_PORTAL_AUDIENCE: AUD, HYPER_PORTAL_ISSUER: issuer } });
    const who = await ctx.fns.auth.currentUser({ req: req(await sign({})) });
    expect(who.user?.role).toBe("member");
});

test("an existing user is linked by email and keeps their role", async () => {
    const ctx = await hyper();
    const [nik] = await ctx.fns.auth.listUsers({});
    const who = await ctx.fns.auth.currentUser({ req: req(await sign({ sub: "p-nik", email: "niquola@health-samurai.io", name: "Nikolai" })) });
    expect(who.user?.id).toBe(nik.id);
    expect(who.user?.role).toBe("owner");
});

test("forged signature is rejected: redirect to login", async () => {
    const ctx = await hyper();
    const forged = await sign({}, { key: attacker.privateKey });
    expect((await ctx.fns.auth.currentUser({ req: req(forged) })).user).toBeNull();
    // Tampered payload with a genuine signature of another payload.
    const [h, , s] = (await sign({})).split(".");
    const tampered = `${h}.${b64({ iss: issuer, aud: AUD, sub: "p-eve", email: "eve@evil.example", exp: Math.floor(Date.now() / 1000) + 60 })}.${s}`;
    expect((await ctx.fns.auth.currentUser({ req: req(tampered) })).user).toBeNull();
    // alg=none and an RSA kid presented as ES256 are refused.
    const none = `${b64({ alg: "none", kid: "rsa1" })}.${b64({ iss: issuer, aud: AUD, sub: "x", email: "x@x.io", exp: Math.floor(Date.now() / 1000) + 60 })}.`;
    expect((await ctx.fns.auth.currentUser({ req: req(none) })).user).toBeNull();
    expect((await ctx.fns.auth.currentUser({ req: req(await sign({}, { alg: "ES256", kid: "rsa1" })) })).user).toBeNull();
    const res = await ctx.fns.procs.http.dispatch({ method: "GET", url: "https://hyper.example/agent/ab", headers: { accept: "text/html", "x-hn-assertion": forged } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toStartWith("/auth/login");
});

test("wrong audience or wrong issuer is ignored", async () => {
    const ctx = await hyper();
    expect((await ctx.fns.auth.currentUser({ req: req(await sign({ aud: "hn:cs/studio/hyper" })) })).user).toBeNull();
    expect((await ctx.fns.auth.currentUser({ req: req(await sign({ iss: "https://evil.example" })) })).user).toBeNull();
});

test("expired assertion, or one valid for more than 120 s, is rejected", async () => {
    const ctx = await hyper();
    const now = Math.floor(Date.now() / 1000);
    expect((await ctx.fns.auth.currentUser({ req: req(await sign({ iat: now - 300, exp: now - 60 })) })).user).toBeNull();
    expect((await ctx.fns.auth.currentUser({ req: req(await sign({ exp: now + 3600 })) })).user).toBeNull();
});

test("disabled user stays blocked even with a valid assertion, also after it was cached", async () => {
    const ctx = await hyper();
    const assertion = await sign({});
    const first = await ctx.fns.auth.currentUser({ req: req(assertion) });
    expect(first.user).not.toBeNull();
    await ctx.fns.auth.setUserDisabled({ id: first.user!.id, disabled: true });
    expect((await ctx.fns.auth.currentUser({ req: req(assertion) })).user).toBeNull();
    expect((await ctx.fns.auth.currentUser({ req: req(await sign({ iat: Math.floor(Date.now() / 1000) - 2 })) })).user).toBeNull();
});

test("bare X-Hn-* headers are never trusted", async () => {
    const ctx = await hyper();
    const who = await ctx.fns.auth.currentUser({ req: req(undefined, { "x-hn-user": "niquola@health-samurai.io", "x-hn-email": "niquola@health-samurai.io" }) });
    expect(who.user).toBeNull();
    expect(who.required).toBe(true);
});

test("mode off (default): a valid assertion changes nothing", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PORTAL_AUDIENCE: AUD, HYPER_PORTAL_ISSUER: issuer } });
    await ctx.fns.auth.createUser({ name: "Nik", email: "niquola@health-samurai.io", password: "password-123" });
    const who = await ctx.fns.auth.currentUser({ req: req(await sign({})) });
    expect(who.user).toBeNull();
    expect(await ctx.fns.auth.listUsers({ includeDisabled: true })).toHaveLength(1);
});
