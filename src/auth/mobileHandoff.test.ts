import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// Native SSO handoff (/auth/mobile/complete → hypermobile://auth/callback?code → POST /auth/mobile/exchange) for a browser that signed in
// through the control plane (OIDC session cookie, jti "s_…"), including OIDC-only servers where plain password/legacy cookies are refused.
const ORIGIN = "http://hyper.test";
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(name + "="))?.split(";")[0] ?? "";

async function setup(env: Record<string, string> = {}) {
    const ctx: any = await mkTestCtx({ env });
    const nik = await ctx.fns.auth.createUser({ name: "Nikolai", email: "niquola@health-samurai.io", password: "password-123" });
    const s = await ctx.fns.auth.oidcSession({ action: "create", req: new Request(`${ORIGIN}/auth/oidc/callback`), userId: nik.id, refreshToken: null });
    const name = ctx.fns.procs.auth.cookieName({});
    return { ctx, nik, name, browser: s.setCookie!.split(";")[0]! };
}
const complete = (ctx: any, cookie: string) => ctx.fns.procs.http.dispatch({ method: "GET", url: `${ORIGIN}/auth/mobile/complete`, headers: { cookie } });
const exchange = (ctx: any, code: string) => ctx.fns.procs.http.dispatch({ method: "POST", url: `${ORIGIN}/auth/mobile/exchange`, headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });

for (const oidcOnly of [false, true]) {
    test(`OIDC browser session → app cookie joins the same control-plane session (oidcOnly=${oidcOnly})`, async () => {
        const { ctx, nik, name, browser } = await setup(oidcOnly ? { HYPER_OIDC_ONLY: "true" } : {});
        const done = await complete(ctx, browser);
        expect(done.status).toBe(303);
        const cb = new URL(done.headers.get("location")!);
        expect(cb.protocol).toBe("hypermobile:");
        const code = cb.searchParams.get("code")!;
        const ex = await exchange(ctx, code);
        expect(ex.status).toBe(200);
        const app = cookieOf(ex, name);
        const claims = JSON.parse(Buffer.from(app.split("=")[1]!.split(".")[1]!, "base64url").toString());
        const browserClaims = JSON.parse(Buffer.from(browser.split("=")[1]!.split(".")[1]!, "base64url").toString());
        expect(claims.jti).toBe(browserClaims.jti);
        expect(claims.jti.startsWith("s_")).toBe(true);
        const who = await ctx.fns.auth.currentUser({ req: new Request(`${ORIGIN}/`, { headers: { cookie: app } }) });
        expect(who.user?.id).toBe(nik.id);
        // single use
        expect((await exchange(ctx, code)).status).toBe(401);
        // revoking the control-plane session ends the app session too (same sid)
        await ctx.fns.procs.db.run({ sql: "UPDATE auth_sessions SET revoked_at = ? WHERE id = ?", params: [Date.now(), claims.jti] });
        expect((await ctx.fns.auth.currentUser({ req: new Request(`${ORIGIN}/`, { headers: { cookie: app } }) })).user).toBeNull();
    });
}

test("revoked control-plane session before exchange: the code is refused", async () => {
    const { ctx, browser } = await setup({ HYPER_OIDC_ONLY: "true" });
    const code = new URL((await complete(ctx, browser)).headers.get("location")!).searchParams.get("code")!;
    await ctx.fns.procs.db.run({ sql: "UPDATE auth_sessions SET revoked_at = ?", params: [Date.now()] });
    expect((await exchange(ctx, code)).status).toBe(401);
});
