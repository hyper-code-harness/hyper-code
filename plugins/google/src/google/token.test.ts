import { afterEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../../../../src/_testCtx.entry";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function makeCtx() {
    return mkTestCtx({ env: {
        HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString("base64"),
        GOOGLE_ACCOUNT: "niquola@gmail.com",
    } });
}

describe("google encrypted local OAuth storage", () => {
    test("serves account metadata and a valid token while bootstrap provider is offline", async () => {
        const ctx = await makeCtx();
        await ctx.fns.secrets.putLocal({ namespace: "google", name: "accounts", value: JSON.stringify(["niquola@gmail.com"]), source: "test" });
        await ctx.fns.secrets.putLocal({ namespace: "google", name: "token:niquola@gmail.com", value: JSON.stringify({ access_token: "local-access", refresh_token: "local-refresh", expires_at: Date.now() + 3_600_000 }), source: "test" });
        ctx.state.registry.secrets.resolve = async () => { throw new Error("1Password unavailable"); };
        (ctx.state as any).secrets = undefined;
        (ctx.state as any).google = undefined;

        expect(await ctx.fns.google.accounts({})).toEqual(["niquola@gmail.com"]);
        expect(await ctx.fns.google.token({ account: "niquola@gmail.com" })).toEqual({ account: "niquola@gmail.com", access_token: "local-access" });
    });

    test("refreshes an expired local token and durably stores the replacement", async () => {
        const ctx = await makeCtx();
        const client = { installed: { client_id: "client-id", client_secret: "client-secret" } };
        await ctx.fns.secrets.putLocal({ namespace: "google", name: "client", value: JSON.stringify(client), source: "test" });
        await ctx.fns.secrets.putLocal({ namespace: "google", name: "token:niquola@gmail.com", value: JSON.stringify({ access_token: "expired", refresh_token: "refresh-old", expires_at: Date.now() - 1 }), source: "test" });
        ctx.state.registry.secrets.resolve = async () => { throw new Error("1Password unavailable"); };
        let body = "";
        globalThis.fetch = (async (_url: any, init: any) => {
            body = String(init.body);
            return Response.json({ access_token: "fresh-access", refresh_token: "refresh-new", expires_in: 3600 });
        }) as any;

        expect((await ctx.fns.google.token({ account: "niquola@gmail.com" })).access_token).toBe("fresh-access");
        expect(body).toContain("refresh_token=refresh-old");
        (ctx.state as any).google = undefined;
        (ctx.state as any).secrets = undefined;
        const stored = JSON.parse(await ctx.fns.secrets.getLocal({ namespace: "google", name: "token:niquola@gmail.com" }) as string);
        expect(stored).toMatchObject({ access_token: "fresh-access", refresh_token: "refresh-new" });
        expect(stored.expires_at).toBeGreaterThan(Date.now() + 3_500_000);
    });
    test("discovers and serves an arbitrary reauthorized account without a hardcoded binding", async () => {
        const ctx = await makeCtx();
        const account = "anna.ryzhikova@health-samurai.io";
        await ctx.fns.secrets.putLocal({ namespace: "google", name: `token:${account}`, value: JSON.stringify({ access_token: "anna-access", refresh_token: "anna-refresh", expires_at: Date.now() + 3_600_000 }), source: "test" });
        ctx.state.registry.secrets.resolve = async () => { throw new Error("1Password unavailable"); };
        (ctx.state as any).secrets = undefined;
        (ctx.state as any).google = undefined;

        expect(await ctx.fns.google.accounts({})).toContain(account);
        expect(await ctx.fns.google.token({ account })).toEqual({ account, access_token: "anna-access" });
    });


});
