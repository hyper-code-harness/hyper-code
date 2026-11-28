import { describe, expect, test } from "bun:test";
import fetchClaude from "./fetchClaude";

// Isolated registry: no settings, keychain, filesystem, Postgres or real HTTP.
function mkTestCtx() {
    const ctx: any = { fns: { llm: {
        claudePoolSelect: async () => ({ enabled: false }),
        refreshClaudeCode: async () => { throw new Error("unexpected credential refresh"); },
    } } };
    ctx.fns.llm.fetchClaude = (opts: Parameters<typeof fetchClaude>[2]) => fetchClaude(ctx, null, opts);
    return ctx;
}
const url = "https://api.anthropic.com/v1/messages";
const request = (ctx: any, extra: object = {}) => ctx.fns.llm.fetchClaude({ provider: "claude-code", account: "work", url,
    init: { method: "POST", body: '{"model":"claude-test","stream":true}', headers: { authorization: "Bearer rejected", "anthropic-beta": "identity" } }, ...extra });
function failed(onCancel: () => void, status = 401) {
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("original error")); }, cancel: onCancel }), { status });
}

describe("fetchClaude unpooled Claude Code 401 recovery", () => {
    test("refreshes the exact rejected bearer once and closes the failed body before replay", async () => {
        const ctx = mkTestCtx();
        const sent: any[] = [];
        let cancelled = false;
        let refreshes = 0;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => { refreshes++; expect(opts).toEqual({ account: "work", rejectedToken: "rejected" }); return "replacement"; };
        ctx.fns.llm.connectFetch = async (opts: any) => {
            sent.push(opts);
            if (sent.length === 1) return failed(() => { cancelled = true; });
            expect(cancelled).toBe(true);
            expect(new Headers(opts.init.headers).get("authorization")).toBe("Bearer replacement");
            expect(new Headers(opts.init.headers).get("anthropic-beta")).toBe("identity");
            expect(opts.init.body).toBe(sent[0].init.body);
            return new Response("ok");
        };
        const result = await request(ctx);
        expect(result).toMatchObject({ provider: "claude-code", account: "work", pooled: false });
        expect(await result.response.text()).toBe("ok");
        expect(refreshes).toBe(1);
        expect(sent).toHaveLength(2);
        expect(new Headers(sent[0].init.headers).get("authorization")).toBe("Bearer rejected");
    });

    test("rejects the sent bearer even if the caller changes its headers in flight", async () => {
        const ctx = mkTestCtx();
        const headers = new Headers({ authorization: "Bearer old-in-flight" });
        let calls = 0;
        ctx.fns.llm.connectFetch = async (opts: any) => {
            calls++;
            if (calls === 1) {
                headers.set("authorization", "Bearer newer-elsewhere");
                expect(new Headers(opts.init.headers).get("authorization")).toBe("Bearer old-in-flight");
                return new Response("unauthorized", { status: 401 });
            }
            expect(new Headers(opts.init.headers).get("authorization")).toBe("Bearer replacement");
            return new Response("ok");
        };
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => { expect(opts.rejectedToken).toBe("old-in-flight"); return "replacement"; };
        expect(await (await request(ctx, { init: { method: "POST", body: "{}", headers } })).response.text()).toBe("ok");
        expect(headers.get("authorization")).toBe("Bearer newer-elsewhere");
        expect(calls).toBe(2);
    });

    for (const replacement of [null, "rejected"]) test(`does not replay when refresh returns ${replacement}`, async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.refreshClaudeCode = async () => replacement;
        ctx.fns.llm.connectFetch = async () => { calls++; return new Response("original error", { status: 401 }); };
        const result = await request(ctx);
        expect(result.response.status).toBe(401);
        expect(await result.response.text()).toBe("original error");
        expect(calls).toBe(1);
    });

    test("a second 401 is returned, never refreshed or retried a third time", async () => {
        const ctx = mkTestCtx();
        let calls = 0, refreshes = 0;
        ctx.fns.llm.refreshClaudeCode = async () => { refreshes++; return "replacement"; };
        ctx.fns.llm.connectFetch = async () => { calls++; return new Response("still unauthorized", { status: 401 }); };
        expect(await (await request(ctx)).response.text()).toBe("still unauthorized");
        expect(calls).toBe(2);
        expect(refreshes).toBe(1);
    });

    for (const status of [200, 400, 403, 429, 500]) test(`HTTP ${status} never invokes rejected-token recovery`, async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.connectFetch = async () => { calls++; return new Response("partial stream or error", { status }); };
        const result = await request(ctx);
        expect(result.response.status).toBe(status);
        expect(await result.response.text()).toBe("partial stream or error");
        expect(calls).toBe(1);
    });

    test("network rejection is not retried", async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.connectFetch = async () => { calls++; throw new Error("offline"); };
        await expect(request(ctx)).rejects.toThrow("offline");
        expect(calls).toBe(1);
    });

    test("a successful stream failing during consumption is not replayed", async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.connectFetch = async () => { calls++; return new Response(new ReadableStream({ pull(c) { c.error(new Error("stream broke")); } })); };
        const result = await request(ctx);
        await expect(result.response.text()).rejects.toThrow("stream broke");
        expect(calls).toBe(1);
    });

    test("does not recover another provider or a non-replayable request body", async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.connectFetch = async () => { calls++; return new Response("original", { status: 401 }); };
        await request(ctx, { provider: "anthropic-oauth" });
        await request(ctx, { provider: "hyper" });
        await request(ctx, { init: { body: new ReadableStream(), headers: { authorization: "Bearer rejected" } } });
        await request(ctx, { init: { body: "{}", headers: {} } });
        expect(calls).toBe(4);
    });

    test("a throwing refresh closes the rejected body and preserves the original failure without replay", async () => {
        const ctx = mkTestCtx();
        let cancelled = false, calls = 0;
        const cause = new Error("credential refresh failed");
        ctx.fns.llm.connectFetch = async () => { calls++; return failed(() => { cancelled = true; }); };
        ctx.fns.llm.refreshClaudeCode = async () => { throw cause; };
        await expect(request(ctx)).rejects.toBe(cause);
        expect(cancelled).toBe(true);
        expect(calls).toBe(1);
    });

    test("refresh failure stays primary when cancelling its rejected body also fails", async () => {
        const ctx = mkTestCtx();
        const cause = new Error("credential refresh failed");
        let cancelled = false;
        ctx.fns.llm.connectFetch = async () => failed(() => { cancelled = true; throw new Error("stream cancellation failed"); });
        ctx.fns.llm.refreshClaudeCode = async () => { throw cause; };
        await expect(request(ctx)).rejects.toBe(cause);
        expect(cancelled).toBe(true);
    });

    test("an abort after the 401 arrives closes its body before refreshing", async () => {
        const ctx = mkTestCtx();
        const controller = new AbortController();
        let cancelled = false;
        ctx.fns.llm.connectFetch = async () => { controller.abort(); return failed(() => { cancelled = true; }); };
        await expect(request(ctx, { init: { body: "{}", headers: { authorization: "Bearer rejected" }, signal: controller.signal } })).rejects.toThrow();
        expect(cancelled).toBe(true);
    });

    test("an abort during credential refresh closes the error body without replaying", async () => {
        const ctx = mkTestCtx();
        const controller = new AbortController();
        let cancelled = false, calls = 0;
        ctx.fns.llm.connectFetch = async () => { calls++; return failed(() => { cancelled = true; }); };
        ctx.fns.llm.refreshClaudeCode = async () => { controller.abort(); return "replacement"; };
        await expect(request(ctx, { init: { method: "POST", body: "{}", headers: { authorization: "Bearer rejected" }, signal: controller.signal } })).rejects.toThrow();
        expect(cancelled).toBe(true);
        expect(calls).toBe(1);
    });

    test("managed pool 401 never reads or recovers a CLI credential", async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.claudePoolSelect = async () => ({ enabled: true, account: "managed" });
        ctx.fns.llm.getAnthropicOAuthToken = async () => "managed-token";
        ctx.fns.llm.recordUsage = async () => {};
        ctx.fns.llm.classifyError = () => ({ kind: "auth" });
        ctx.fns.llm.connectFetch = async (opts: any) => { calls++; expect(new Headers(opts.init.headers).get("authorization")).toBe("Bearer managed-token"); return new Response("pool auth error", { status: 401 }); };
        const result = await request(ctx);
        expect(result.pooled).toBe(true);
        expect(await result.response.text()).toBe("pool auth error");
        expect(calls).toBe(1);
    });
});
