import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkTestCtx } from "../_testCtx.entry";

// End-to-end against the real Hyper Control Plane (sibling repo ~/hyper-control-plane) with a fake Google.
// Skipped when the control plane checkout is not present.
const CP = process.env.HYPER_CONTROL_PLANE_DIR ?? `${process.env.HOME}/hyper-control-plane`;
const available = existsSync(`${CP}/scripts/e2e-server.ts`);
const ORIGIN = "http://hyper.test";

let cp: { issuer: string; clientId: string; clientSecret: string; admin: string };
let proc: ReturnType<typeof Bun.spawn> | null = null;

beforeAll(async () => {
    if (!available) return;
    proc = Bun.spawn(["bun", `${CP}/scripts/e2e-server.ts`, ORIGIN], { stdout: "pipe", stderr: "inherit", cwd: CP });
    const reader = proc.stdout.getReader();
    let buf = "";
    while (!buf.includes("\n")) { const { value, done } = await reader.read(); if (done) break; buf += new TextDecoder().decode(value); }
    cp = JSON.parse(buf.trim().split("\n").pop()!);
});
afterAll(async () => { if (cp) await fetch(cp.admin + "stop").catch(() => {}); proc?.kill(); });

async function hyper() {
    return mkTestCtx({ env: { HYPER_OIDC_ISSUER: cp.issuer, HYPER_OIDC_CLIENT_ID: cp.clientId, HYPER_OIDC_CLIENT_SECRET: cp.clientSecret, HYPER_OIDC_LABEL: "Health Samurai" } });
}
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(name + "="))?.split(";")[0] ?? "";

/** Browser dance: Hyper -> control plane -> (fake) Google -> control plane -> Hyper callback. */
async function signIn(ctx: any, account: Record<string, unknown>) {
    await fetch(cp.admin + "account", { method: "POST", body: JSON.stringify(account) });
    const start = await ctx.fns.procs.http.dispatch({ method: "GET", url: `${ORIGIN}/auth/oidc?next=/agent/ab` });
    expect(start.status).toBe(303);
    const stateCookie = cookieOf(start, "hyper_oidc_state");
    let loc = start.headers.get("location")!;
    expect(loc.startsWith(cp.issuer + "/authorize")).toBe(true);
    for (let i = 0; i < 4 && !loc.startsWith(ORIGIN); i++) loc = (await fetch(loc, { redirect: "manual" })).headers.get("location")!;
    const cb = new URL(loc);
    return ctx.fns.procs.http.dispatch({ method: "GET", url: `${ORIGIN}/auth/oidc/callback${cb.search}`, headers: { cookie: stateCookie } });
}

test.skipIf(!available)("off by default; on with issuer + client: login page shows the button", async () => {
    const plain = await mkTestCtx({ env: { HYPER_PASSWORD: "x-legacy-pass" } });
    expect(await plain.fns.auth.oidcConfig({})).toBeNull();
    const ctx = await hyper();
    const cfg = await ctx.fns.auth.oidcConfig({});
    expect(cfg?.tokenEndpoint).toBe(cp.issuer + "/token");
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const page = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/login" })).text();
    expect(page).toContain("Sign in with Health Samurai");
    expect(page).toContain('name="password"');
});

test.skipIf(!available)("sign in through the control plane: user created, session works, link by email", async () => {
    const ctx = await hyper();
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await signIn(ctx, { sub: "g-nik", email: "niquola@health-samurai.io", name: "Nikolai R", hd: "health-samurai.io" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/agent/ab");
    const session = cookieOf(res, ctx.fns.procs.auth.cookieName({}));
    const me = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: session } })).json();
    expect(me.user.id).toBe(nik.id); // linked to the existing user by email, not duplicated
    const anna = await signIn(ctx, { sub: "g-anna", email: "anna@health-samurai.io", name: "Anna K", hd: "health-samurai.io" });
    const annaMe = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: cookieOf(anna, ctx.fns.procs.auth.cookieName({})) } })).json();
    expect(annaMe.user.email).toBe("anna@health-samurai.io");
    expect(annaMe.user.role).toBe("member");
});

test.skipIf(!available)("gmail refused by the control plane shows on Hyper's login page", async () => {
    const ctx = await hyper();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await signIn(ctx, { sub: "g-x", email: "x@gmail.com", name: "X", hd: undefined });
    expect(res.headers.get("location")).toContain("/auth/login?error=");
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("health-samurai.io");
});

test.skipIf(!available)("expired short session renews silently; disabling the user at the control plane ends it", async () => {
    const ctx = await hyper();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await signIn(ctx, { sub: "g-bob", email: "bob@health-samurai.io", name: "Bob", hd: "health-samurai.io" });
    const name = ctx.fns.procs.auth.cookieName({});
    const good = cookieOf(res, name);
    const claims = JSON.parse(Buffer.from(good.split("=")[1]!.split(".")[1]!, "base64url").toString());
    // Forge an *expired* but correctly signed cookie for the same session, as if 15 minutes passed.
    const expired = `${name}=` + await ctx.fns.procs.auth.sign({ sub: claims.sub, name: claims.name, email: claims.email, role: claims.role, jti: claims.jti, seconds: -60 });
    // Past the 30 s renewal debounce, as if the tab had been idle.
    const idle = () => ctx.fns.procs.db.run({ sql: "UPDATE auth_sessions SET refreshed_at = refreshed_at - 3600000 WHERE id = ?", params: [claims.jti] });
    await idle();
    const renewed = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: expired } });
    expect(renewed.status).toBe(200);
    expect((await renewed.json()).user.email).toBe("bob@health-samurai.io");
    const fresh = cookieOf(renewed, name);
    expect(fresh).toBeTruthy(); // new cookie handed back on the same response
    // The provider-side refresh token was rotated and stored.
    const [row] = await ctx.fns.procs.db.select({ sql: "SELECT refreshed_at, created_at FROM auth_sessions WHERE id = ?", params: [claims.jti] });
    expect(Number(row.refreshed_at)).toBeGreaterThanOrEqual(Number(row.created_at));

    // Disable Bob at the control plane: the next renewal is refused and the session ends.
    await fetch(cp.admin + "disable", { method: "POST", body: JSON.stringify({ email: "bob@health-samurai.io" }) });
    await idle();
    const again = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: expired } });
    expect(again.status).toBe(401);
    const [ended] = await ctx.fns.procs.db.select({ sql: "SELECT revoked_at FROM auth_sessions WHERE id = ?", params: [claims.jti] });
    expect(ended.revoked_at).not.toBeNull();
});

test.skipIf(!available)("logout revokes the server-side session", async () => {
    const ctx = await hyper();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await signIn(ctx, { sub: "g-carol", email: "carol@health-samurai.io", name: "Carol", hd: "health-samurai.io" });
    const cookie = cookieOf(res, ctx.fns.procs.auth.cookieName({}));
    await ctx.fns.procs.http.dispatch({ method: "POST", url: "/auth/logout", headers: { cookie, accept: "application/json" } });
    const sid = JSON.parse(Buffer.from(cookie.split("=")[1]!.split(".")[1]!, "base64url").toString()).jti;
    const [row] = await ctx.fns.procs.db.select({ sql: "SELECT revoked_at FROM auth_sessions WHERE id = ?", params: [sid] });
    expect(row.revoked_at).not.toBeNull();
});

test.skipIf(!available)("OIDC-only mode: no password form, password and legacy sessions refused, only the provider lets in", async () => {
    const ctx = await mkTestCtx({ env: { HYPER_OIDC_ISSUER: cp.issuer, HYPER_OIDC_CLIENT_ID: cp.clientId, HYPER_OIDC_CLIENT_SECRET: cp.clientSecret, HYPER_OIDC_ONLY: "true", HYPER_PASSWORD: "legacy-pass-123" } });
    expect(await ctx.fns.auth.oidcOnly({})).toBe(true);
    const name = ctx.fns.procs.auth.cookieName({});
    // No users yet: still closed (no open mode, no setup).
    const anon = await ctx.fns.procs.http.dispatch({ method: "GET", url: "/agent/ab", headers: { accept: "text/html" } });
    expect(anon.status).toBe(303);
    expect(anon.headers.get("location")).toContain("/auth/login");
    expect((await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/setup" })).headers.get("location")).toBe("/auth/login");
    const page = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/login" })).text();
    expect(page).toContain("Sign in with");
    expect(page).not.toContain('name="password"');
    // Password sign-in (legacy shared password) is refused.
    const pw = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "legacy-pass-123" }) });
    expect(pw.status).toBe(403);
    // A plain signed cookie (password-style session) does not count.
    const legacy = `${name}=` + await ctx.fns.procs.auth.sign({ sub: "password-user", name: "Hyper user", role: "owner", days: 1 });
    expect((await ctx.fns.procs.http.dispatch({ method: "GET", url: "/agent/ab", headers: { cookie: legacy, accept: "application/json" } })).status).toBe(401);
    // The control plane lets people in; the first becomes owner.
    const res = await signIn(ctx, { sub: "g-val", email: "valeria@health-samurai.io", name: "Valeria", hd: "health-samurai.io" });
    const me = await (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: cookieOf(res, name) } })).json();
    expect(me.user.email).toBe("valeria@health-samurai.io");
    expect(me.user.role).toBe("owner");
});

test.skipIf(!available)("concurrent requests renew one session once: no refresh-token reuse, nobody is signed out", async () => {
    const ctx = await hyper();
    await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const res = await signIn(ctx, { sub: "g-dan", email: "dan@health-samurai.io", name: "Dan", hd: "health-samurai.io" });
    const name = ctx.fns.procs.auth.cookieName({});
    const claims = JSON.parse(Buffer.from(cookieOf(res, name).split("=")[1]!.split(".")[1]!, "base64url").toString());
    // Past the debounce window, with an expired cookie — as a tab coming back after 15 minutes.
    await ctx.fns.procs.db.run({ sql: "UPDATE auth_sessions SET refreshed_at = refreshed_at - 3600000 WHERE id = ?", params: [claims.jti] });
    const expired = `${name}=` + await ctx.fns.procs.auth.sign({ sub: claims.sub, name: claims.name, email: claims.email, role: claims.role, jti: claims.jti, seconds: -60 });
    const before = ((await (await fetch(cp.admin + "events")).json()) as any).events.length;
    // A page fires several requests at once.
    const all = await Promise.all(Array.from({ length: 6 }, () => ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: expired } })));
    expect(all.map((r: Response) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const r of all) expect(cookieOf(r, name)).toBeTruthy();
    const events: string[] = ((await (await fetch(cp.admin + "events")).json()) as any).events.slice(before);
    expect(events).not.toContain("refresh.reuse_detected");
    const [row] = await ctx.fns.procs.db.select({ sql: "SELECT revoked_at FROM auth_sessions WHERE id = ?", params: [claims.jti] });
    expect(row.revoked_at).toBeNull();
    // A second burst right after is debounced: still fine, still one live session.
    const again = await Promise.all(Array.from({ length: 3 }, () => ctx.fns.procs.http.dispatch({ method: "GET", url: "/auth/session", headers: { cookie: expired } })));
    expect(again.map((r: Response) => r.status)).toEqual([200, 200, 200]);
});
