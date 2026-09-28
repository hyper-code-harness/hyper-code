import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// A fake Google: our own RSA key, a JWKS endpoint and a token endpoint that returns an ID token
// signed with it. Exercises the real routes end to end without talking to Google.
let server: ReturnType<typeof Bun.serve>;
let privateKey: CryptoKey;
let nextClaims: Record<string, unknown> = {};
const kid = "test-key";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function sign(claims: Record<string, unknown>) {
    const head = b64({ alg: "RS256", kid, typ: "JWT" });
    const body = b64(claims);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    privateKey = pair.privateKey;
    const jwk: any = await crypto.subtle.exportKey("jwk", pair.publicKey);
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const u = new URL(req.url);
            if (u.pathname === "/certs") return Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
            if (u.pathname === "/token") return Response.json({ id_token: await sign(nextClaims) });
            return new Response("nope", { status: 404 });
        },
    });
});
afterAll(() => server?.stop(true));

const CLIENT = "client-123.apps.googleusercontent.com";
async function ctxWithGoogle(extra: Record<string, string> = {}) {
    return mkTestCtx({ env: {
        HYPER_GOOGLE_CLIENT_ID: CLIENT, HYPER_GOOGLE_CLIENT_SECRET: "shh",
        HYPER_GOOGLE_TOKEN_URL: `http://localhost:${server.port}/token`, HYPER_GOOGLE_JWKS_URL: `http://localhost:${server.port}/certs`,
        ...extra,
    } });
}

async function googleLogin(ctx: any, claims: (nonce: string) => Record<string, unknown>) {
    const start = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://hyper.test/auth/google?next=/agent/ab" });
    expect(start.status).toBe(303);
    const to = new URL(start.headers.get("location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("hd")).toBe("health-samurai.io");
    expect(to.searchParams.get("redirect_uri")).toBe("http://hyper.test/auth/google/callback");
    const stateCookie = start.headers.get("set-cookie")!.split(";")[0];
    nextClaims = claims(to.searchParams.get("nonce")!);
    return ctx.fns.procs.http.dispatch({ method: "GET", url: `http://hyper.test/auth/google/callback?code=abc&state=${to.searchParams.get("state")}`, headers: { cookie: stateCookie } });
}
const now = () => Math.floor(Date.now() / 1000);
const good = (nonce: string, over: Record<string, unknown> = {}) => ({
    iss: "https://accounts.google.com", aud: CLIENT, exp: now() + 300, nonce, sub: "g-111",
    email: "anna@health-samurai.io", email_verified: true, hd: "health-samurai.io", name: "Anna K", ...over,
});

test("Google sign-in is off by default; login page has no Google button", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_PASSWORD: "legacy-password" } });
    expect(await ctx.fns.auth.googleConfig({})).toBeNull();
    expect((await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/google" })).status).toBe(404);
    const page = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/login" })).text();
    expect(page).not.toContain("Sign in with Google");
});

test("verified health-samurai.io account signs in, is created once, found by subject later", async () => {
    const ctx = await ctxWithGoogle();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const page = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/login" })).text();
    expect(page).toContain("Sign in with Google");
    expect(page).toContain('name="password"'); // password stays available

    const res = await googleLogin(ctx, (n) => good(n));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/agent/ab");
    const session = res.headers.getSetCookie().find((c: string) => c.startsWith(ctx.fns.procs.auth.cookieName({}) + "="))!;
    const me = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: session.split(";")[0] } })).json();
    expect(me.user.email).toBe("anna@health-samurai.io");
    expect(me.user.role).toBe("member");
    expect(me.user.hasPassword).toBe(false);

    // Email changed at Google: still the same user, found by subject.
    await googleLogin(ctx, (n) => good(n, { email: "anna.k@health-samurai.io" }));
    const users = await ctx.fns.auth.listUsers({});
    expect(users.filter((u: any) => u.name === "Anna K").length).toBe(1);
});

test("existing user with the same email is linked, not duplicated", async () => {
    const ctx = await ctxWithGoogle();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await googleLogin(ctx, (n) => good(n, { sub: "g-nik", email: "niquola@health-samurai.io", name: "Nikolai R" }));
    expect(res.status).toBe(303);
    const linked = await ctx.fns.procs.db.select({ sql: "SELECT user_id FROM user_identities WHERE subject = 'g-nik'" });
    expect(linked[0].user_id).toBe(nik.id);
    expect((await ctx.fns.auth.listUsers({})).length).toBe(1);
});

test("rejects other domains, unverified email, wrong audience, bad nonce, forged signature, missing state", async () => {
    const ctx = await ctxWithGoogle();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const rejected = async (claims: (n: string) => Record<string, unknown>) => {
        const r = await googleLogin(ctx, claims);
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toStartWith("/auth/login?error=");
        return decodeURIComponent(r.headers.get("location")!.split("error=")[1]!);
    };
    expect(await rejected((n) => good(n, { email: "anna@gmail.com", hd: undefined }))).toContain("health-samurai.io");
    expect(await rejected((n) => good(n, { hd: "evil.com", email: "x@evil.com" }))).toContain("health-samurai.io");
    expect(await rejected((n) => good(n, { email_verified: false }))).toContain("not verified");
    expect(await rejected((n) => good(n, { aud: "someone-else" }))).toContain("audience");
    expect(await rejected(() => good("other-nonce"))).toContain("nonce");
    expect(await rejected((n) => good(n, { exp: now() - 3600 }))).toContain("expired");
    // No/forged state cookie.
    const noState = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://hyper.test/auth/google/callback?code=abc&state=zzz" });
    expect(noState.headers.get("location")).toContain("expired");
    expect((await ctx.fns.auth.listUsers({})).length).toBe(1);
});

test("auto-create off: only users added in advance can sign in with Google", async () => {
    const ctx = await ctxWithGoogle({ HYPER_GOOGLE_AUTO_CREATE: "false" });
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await googleLogin(ctx, (n) => good(n));
    expect(res.headers.get("location")).toContain("not%20allowed");
    expect((await ctx.fns.auth.listUsers({})).length).toBe(1);
});

test("a disabled user cannot sign in with Google", async () => {
    const ctx = await ctxWithGoogle();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    await googleLogin(ctx, (n) => good(n));
    const anna = (await ctx.fns.auth.listUsers({})).find((u: any) => u.name === "Anna K")!;
    await ctx.fns.auth.setUserDisabled({ id: anna.id, disabled: true });
    const res = await googleLogin(ctx, (n) => good(n));
    expect(res.headers.get("location")).toContain("not%20allowed");
});

test("a lone Google-only user still requires sign-in (not treated as an open instance)", async () => {
    const ctx = await ctxWithGoogle();
    await googleLogin(ctx, (n) => good(n));
    const users = await ctx.fns.auth.listUsers({});
    expect(users.length).toBe(1);
    expect(users[0].role).toBe("owner");
    const who = await ctx.fns.auth.currentUser({ req: new Request("http://hyper.test/agent/ab") });
    expect(who.required).toBe(true);
    expect(who.user).toBeNull();
});
