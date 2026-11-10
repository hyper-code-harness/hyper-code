import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function fixture(models: Record<string, string[]>, cached: object[] = []) {
    const ctx = await mkTestCtx();
    ctx.state.registry.llm.listModels = async () => models;
    ctx.state.registry.llm.resolveEndpoint = async (_c: unknown, _s: unknown, opts: { model: string }) => {
        const provider = opts.model.split(":")[0]!.split("/")[0]!;
        return { provider, api: provider === "cursor" ? "cursor" : provider === "codex" ? "responses" : "anthropic", kind: "subscription" };
    };
    ctx.state.registry.node.list = async () => [{ name: "upstream", enabled: true, catalog: cached }];
    return ctx;
}

describe("node relay catalogue capabilities", () => {
    test("Cursor remains locally listed but never displaces supported Claude and Codex", async () => {
        const ctx = await fixture({ cursor: ["cursor:claude-opus-5-5", "cursor:cursor-only"], "claude-code": ["claude-code:claude-opus-5-5"], codex: ["codex:gpt-test"] });
        expect((await ctx.fns.llm.listModels({ skipNodes: true })).cursor).toHaveLength(2);
        expect(await ctx.fns.node.catalog({})).toEqual([
            { id: "claude-opus-5-5", api: "anthropic", provider: "claude-code", account: "default", kind: "subscription" },
            { id: "gpt-test", api: "responses", provider: "codex", account: "default", kind: "subscription" },
        ]);
    });
    test("Claude disappearance does not promise same-id Cursor, including stale cached api", async () => {
        const ctx = await fixture({ cursor: ["cursor:claude-opus-5-5"] }, [
            { id: "claude-opus-5-5", provider: "cursor", api: "anthropic", account: "default", kind: "subscription" },
            { id: "other", provider: "old-provider", api: "cursor", account: "default", kind: "subscription" },
        ]);
        expect(await ctx.fns.node.catalog({})).toEqual([]);
    });
    test("unsupported cached collisions do not hide supported chained models; grants still apply", async () => {
        const ctx = await fixture({}, [
            { id: "shared", provider: "cursor", api: "openai", account: "default", kind: "subscription" },
            { id: "shared", provider: "codex", api: "responses", account: "work", kind: "subscription" },
        ]);
        expect(await ctx.fns.node.catalog({})).toEqual([{ id: "shared", provider: "codex", api: "responses", account: "work", kind: "subscription", via: "hyper/upstream" }]);
        expect(await ctx.fns.node.catalog({ providers: ["cursor"] })).toEqual([]);
        expect(await ctx.fns.node.catalog({ hops: 2 })).toEqual([]);
    });
    test("relay rejects a stale anthropic request for a disappeared Claude without dispatch", async () => {
        const ctx = await fixture({ cursor: ["cursor:claude-opus-5-5"] });
        ctx.state.registry.node.authorize = async () => ({ ok: true, client: { name: "client", providers: [] }, hops: 0 });
        ctx.state.registry.node.upstream = async () => { throw new Error("must not dispatch"); };
        const response = await ctx.fns.node.relay({ api: "anthropic", req: new Request("http://localhost/node/v1/anthropic", { method: "POST", body: JSON.stringify({ model: "claude-opus-5-5" }) }) });
        expect(response.status).toBe(404);
    });
});
