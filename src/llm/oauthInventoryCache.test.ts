import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
let c: any;
beforeAll(async () => { c = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"), HOME: "/nonexistent-hyper-inventory" } }); });
beforeEach(async () => {
    await c.fns.procs.db.run({ sql: "DELETE FROM oauth_credentials", params: [] });
    c.state.llm = {};
    c.state.registry.llm.usageOverview = async () => [];
    c.state.registry.llm.accountAuthHealth = async () => [];
    c.state.registry.llm.accountCredentialExists = async () => false;
    c.state.registry.node.status = async () => [];
});
describe("managed credential inventory invalidation", () => {
    for (const provider of ["anthropic-oauth", "xai"]) {
        test(`${provider} save/logout immediately refresh inventory without dropping CLI token cache`, async () => {
            expect(await c.fns.llm.listAccounts({ provider })).toEqual([]);
            const tokens = new Map([["fixture", {}]]);
            c.state.llm.claudeCodeTokens = tokens;
            if (provider === "anthropic-oauth") await c.fns.llm.saveAnthropicOAuth({ account: "work", access: "fixture-access", refresh: "fixture-refresh", expiresAt: Date.now() + 60_000 });
            else await c.fns.llm.saveXaiOAuth({ account: "work", access: "fixture-access", refresh: "fixture-refresh", expiresAt: Date.now() + 60_000 });
            const accounts = await c.fns.llm.listAccounts({ provider });
            expect(accounts).toHaveLength(1);
            expect(accounts[0].account).toBe("work");
            expect(c.state.llm.claudeCodeTokens).toBe(tokens);
            if (provider === "anthropic-oauth") await c.fns.llm.logoutAnthropicOAuth({ account: "work" });
            else await c.fns.llm.logoutXaiOAuth({ account: "work" });
            expect(await c.fns.llm.listAccounts({ provider })).toEqual([]);
            expect(c.state.llm.claudeCodeTokens).toBe(tokens);
        });
    }
});
