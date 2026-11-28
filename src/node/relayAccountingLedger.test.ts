import { afterEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import schema from "../llmUsage/schema.entry";

let ctx: any;
async function fixture(provider = "openai") {
    ctx = await mkTestCtx();
    await schema.up(ctx);
    await ctx.fns.procs.db.exec({ sql: "TRUNCATE llm_usage_attempts, llm_usage_calls" });
    const get = ctx.state.registry.settings.get;
    ctx.state.registry.settings.get = (c: any, s: any, o: any) => o.module === "llmUsage" ? true : get(c, s, o);
    ctx.state.registry.node.authorize = async () => ({ ok: true, client: { id: "client-a", name: "instance-a", providers: [] }, hops: 0 });
    ctx.state.registry.node.catalog = async () => [{ id: "model-a", provider, account: "requested", api: provider === "openai" ? "openai" : "anthropic" }];
    ctx.state.registry.node.upstream = async () => ({ url: "https://api.anthropic.com/v1/messages", headers: {}, kind: "subscription", provider, account: "resolved" });
    ctx.state.registry.procs.log.info = () => {};
    return ctx;
}
afterEach(async () => { if (ctx) await schema.down(ctx); ctx = undefined; });
const req = () => new Request("https://hyper.test/node/v1/anthropic", { method: "POST", headers: { "content-type": "application/json", "x-origin-agent": "forged-agent", "x-origin-client": "forged-client" }, body: JSON.stringify({ model: "model-a", messages: [{ role: "user", content: "private-prompt-sentinel" }] }) });

describe("terminal relay real accounting ledger", () => {
    test("pool failover retains actual accounts and one successful incoming call after body consumption", async () => {
        const c = await fixture("claude-code");
        let selected = "account-a", sends = 0;
        c.state.registry.llm.claudePoolSelect = async (_c: any, _s: any, o: any) => {
            if (o.failedAccount) selected = "account-b";
            return { enabled: true, account: selected, accounts: [{ account: selected, available: true }] };
        };
        c.state.registry.llm.getAnthropicOAuthToken = async () => "private-auth-sentinel";
        c.state.registry.llm.recordUsage = async () => null;
        c.state.registry.llm.classifyError = () => ({ kind: "usage_limit", resetsAt: Date.now() + 60000 });
        const stream = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":8,"cache_creation_input_tokens":0}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":6}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
        c.state.registry.llm.connectFetch = async () => ++sends === 1
            ? Response.json({ error: { type: "usage_limit_reached", message: "private-error-sentinel" } }, { status: 429 })
            : new Response(stream, { headers: { "content-type": "text/event-stream" } });
        const res = await c.fns.node.relay({ req: req(), api: "anthropic" });
        expect(res.status).toBe(200);
        const before = await c.fns.procs.db.select({ sql: "SELECT status FROM llm_usage_calls" });
        expect(before).toEqual([{ status: "pending" }]);
        expect(await res.text()).toBe(stream);
        const calls = await c.fns.procs.db.select({ sql: "SELECT * FROM llm_usage_calls" });
        const attempts = await c.fns.procs.db.select({ sql: "SELECT * FROM llm_usage_attempts ORDER BY started_at,id" });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ source: "node", client_id: "client-a", client_name: "instance-a", status: "success", agent_id: null });
        expect(attempts).toHaveLength(2);
        expect(attempts.map((a: any) => [a.provider, a.account, a.status])).toEqual([["anthropic-oauth", "account-a", "error"], ["anthropic-oauth", "account-b", "success"]]);
        expect(attempts[0].input_tokens).toBeNull();
        expect([attempts[1].input_tokens, attempts[1].output_tokens, attempts[1].cache_read_tokens, attempts[1].cache_write_tokens].map(Number)).toEqual([12, 6, 8, 0]);
        expect(attempts[1].usage_state).toBe("known");
        expect(JSON.stringify({ calls, attempts })).not.toMatch(/private-|forged-/);
        expect(sends).toBe(2);
    });
});
