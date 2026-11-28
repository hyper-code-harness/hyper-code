import { describe, expect, test } from "bun:test";
import fetchClaude from "./fetchClaude";

// Physical-send hook tests only: no database, real credentials or provider HTTP.
function fixture(pooled = false) {
    const observed: Array<Record<string, string>> = [];
    let account = "first";
    const c: any = { fns: { llmUsage: { fetch: async (opts: any) => {
        observed.push({ provider: opts.provider, account: opts.account, model: opts.model, api: opts.api });
        expect(Object.keys(opts).sort()).toEqual(["account", "api", "model", "provider", "send"]);
        return opts.send();
    } }, llm: {
        claudePoolSelect: async (o: any) => {
            if (o.failedAccount) account = "second";
            return { enabled: pooled, account, accounts: [{ account, available: true }] };
        },
        getAnthropicOAuthToken: async () => "private-bearer",
        recordUsage: async () => null,
        refreshClaudeCode: async () => "new-private-bearer",
        classifyError: () => ({ kind: "usage_limit", resetsAt: Date.now() + 10000 }),
    } } };
    const request = () => fetchClaude(c, null, { provider: "claude-code", account: "requested", url: "https://api.anthropic.com/v1/messages", init: {
        method: "POST", headers: { authorization: "Bearer rejected-private-bearer" },
        body: JSON.stringify({ model: "claude-model", messages: [{ role: "user", content: "private-prompt" }] }),
    } });
    return { c, request, observed };
}

describe("Claude accounting physical-send integration", () => {
    test("records each real pool send with the selected account, not the requested alias", async () => {
        const { c, request, observed } = fixture(true);
        let sends = 0;
        c.fns.llm.connectFetch = async () => ++sends === 1
            ? Response.json({ error: { type: "usage_limit_reached" } }, { status: 429 })
            : Response.json({ usage: { input_tokens: 8, output_tokens: 3 } });
        const result = await request();
        expect(result.account).toBe("second");
        expect(await result.response.json()).toEqual({ usage: { input_tokens: 8, output_tokens: 3 } });
        expect(observed).toEqual([
            { provider: "anthropic-oauth", account: "first", model: "claude-model", api: "anthropic" },
            { provider: "anthropic-oauth", account: "second", model: "claude-model", api: "anthropic" },
        ]);
        expect(sends).toBe(2);
        expect(JSON.stringify(observed)).not.toMatch(/private|authorization|messages/);
    });

    test("a credential retry creates two physical attempts but does not add a logical run", async () => {
        const { c, request, observed } = fixture();
        let sends = 0;
        c.fns.llm.connectFetch = async () => ++sends === 1 ? new Response("denied", { status: 401 }) : new Response("ok");
        expect(await (await request()).response.text()).toBe("ok");
        expect(observed).toHaveLength(2);
        expect(observed.every(row => row.provider === "claude-code" && row.account === "requested")).toBe(true);
        expect(sends).toBe(2);
    });

    test("transport rejection is not retried by instrumentation", async () => {
        const { c, request, observed } = fixture();
        const failure = new Error("network failed");
        let sends = 0;
        c.fns.llm.connectFetch = async () => { sends++; throw failure; };
        await expect(request()).rejects.toBe(failure);
        expect(sends).toBe(1);
        expect(observed).toHaveLength(1);
    });
});
