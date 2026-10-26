import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent.modelPicker", () => {
    test("groups model routes by provider and marks the current model", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        ctx.fns.llm.listModels = async () => ({
            mock: ["mock:test", "mock:other"],
            openai: ["openai:gpt-test"],
        });

        const response = await ctx.fns.agent.modelPicker({ agentId: agent.id });
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain("Provider, account and model");
        expect(html).toContain("mock:test");
        expect(html).toContain("mock:other");
        expect(html).toContain("OpenAI API");
        expect(html).toContain('aria-current="page"');
        expect(html).toContain(`/agent/${agent.id}/model`);
        expect(html).toContain("data-model-provider-tab");
        expect(html).toContain('&quot;scope&quot;:&quot;agent&quot;');
        expect(html).toContain("aria-selected");
        expect(html).toContain("data-model-provider-panel");
        expect(html).toContain('data-model-provider-panel hidden');

    });

    test("expands named credential accounts into concrete model routes", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "codex:gpt-test" });
        ctx.fns.llm.listModels = async () => ({ codex: ["codex:gpt-test"] });
        ctx.fns.llm.listAccounts = async () => ([
            { provider: "codex", account: "default", available: true, usedPercent: 84, planType: "team" },
            { provider: "codex", account: "persona", available: true, usedPercent: 0, planType: "pro" },
        ]);

        const html = await (await ctx.fns.agent.modelPicker({ agentId: agent.id })).text();
        expect(html).toContain("codex/persona:gpt-test");
        expect(html).toContain("16% left");
        expect(html).toContain("100% left");
        expect(html).toContain("This changes only agent");
    });


    test("shows each Hyper node as a proxy with the host's providers as accounts", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "hyper/anna:gpt-x" });
        ctx.fns.llm.listModels = async () => ({ codex: ["codex:gpt-x"], "hyper/anna": ["hyper/anna:gpt-x", "hyper/anna:claude-y"] });
        ctx.fns.llm.listAccounts = async () => ([{ provider: "hyper", account: "anna", available: true, usedPercent: 3, planType: "pro" }]);
        ctx.fns.node.list = async () => ([{ name: "anna", url: "http://x", enabled: true, catalogAt: 1, usageAt: 1, lastError: null,
            catalog: [{ id: "gpt-x", api: "responses", provider: "codex", account: "default", kind: "subscription" }, { id: "claude-y", api: "anthropic", provider: "claude-code", account: "default", kind: "subscription" }],
            usage: [{ provider: "codex", account: "default", usedPercent: 3, resetsAt: null, planType: "pro", parkedAgents: 0 }] }]);
        const html = await (await ctx.fns.agent.modelPicker({ agentId: agent.id })).text();
        expect(html).toContain("via proxy");
        expect(html).toContain("anna → Codex");
        expect(html).toContain("anna → Claude Code");
        expect(html).toContain("97% left");
        expect(html).toContain('data-model-route="hyper/anna:claude-y"');
        expect(html).not.toContain("Hyper nodes");
    });

    test("keeps the current route visible when it is absent from the catalogue", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:private" });
        ctx.fns.llm.listModels = async () => ({});

        const response = await ctx.fns.agent.modelPicker({ agentId: agent.id });
        expect(await response.text()).toContain("mock:private");
    });

    test("returns 404 for an unknown agent", async () => {
        const ctx: any = await mkTestCtx();
        const response = await ctx.fns.agent.modelPicker({ agentId: "missing" });
        expect(response.status).toBe(404);
    });

    test("switches through the HTTP route and asks HTMX to refresh the chat", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        const response = await ctx.fns.procs.http.dispatch({
            url: `/agent/${agent.id}/model`,
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" },
            body: new URLSearchParams({ model: "mock:other" }).toString(),
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("HX-Refresh")).toBe("true");
        expect((await ctx.fns.session.load({ id: agent.id })).model).toBe("mock:other");
    });

    test("shows the model count and keeps quota-exhausted accounts selectable", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "codex:gpt-test" });
        ctx.fns.llm.listModels = async () => ({ "claude-code": ["claude-code:claude-haiku-4-5", "claude-code:claude-sonnet-5", "claude-code:claude-opus-5"] });
        ctx.fns.llm.listAccounts = async () => ([{ provider: "claude-code", account: "default", available: false, needsReconnect: false, usedPercent: 100, planType: "team" }]);
        const html = await (await ctx.fns.agent.modelPicker({ agentId: agent.id })).text();
        expect(html).toContain(">3<");
        expect(html).toContain("claude-code:claude-opus-5");
        expect(html).not.toMatch(/data-model-route="claude-code:claude-opus-5"[^>]*aria-disabled/);
    });


    test("renders reconnect-required accounts and disables their models", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "codex:gpt-test" });
        ctx.fns.llm.listModels = async () => ({ codex: ["codex:gpt-test"] });
        ctx.fns.llm.listAccounts = async () => ([{ provider: "codex", account: "expired", available: false, needsReconnect: true, usedPercent: null, planType: null }]);
        const html = await (await ctx.fns.agent.modelPicker({ agentId: agent.id })).text();
        expect(html).toContain("Reconnect required");
        expect(html).toContain("codex/expired:gpt-test");
        expect(html).toMatch(/data-model-route="codex\/expired:gpt-test"[^>]*aria-disabled/);
    });

});
