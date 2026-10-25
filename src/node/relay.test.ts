import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("node.relay", () => {
    test("merges the client's anthropic-beta with the host's identity betas", async () => {
        const ctx: any = await mkTestCtx();
        const reg = ctx.state.registry;
        reg.node.authorize = async () => ({ ok: true, client: { name: "c", providers: ["claude-code"] }, hops: 0 });
        reg.node.catalog = async () => [{ id: "claude-x", api: "anthropic", provider: "claude-code", account: "default" }];
        reg.node.upstream = async () => ({ url: "https://upstream.test/v1/messages", kind: "subscription", headers: { "content-type": "application/json", "anthropic-beta": "claude-code-20250219,oauth-2025-04-20" } });
        const realFetch = globalThis.fetch;
        let sent: Record<string, string> = {};
        globalThis.fetch = (async (_url: any, init: any) => { sent = init.headers; return new Response("{}", { status: 200 }); }) as any;
        try {
            const req = new Request("http://host/v1/anthropic", { method: "POST", headers: { "anthropic-beta": "claude-code-20250219,compact-2026-09-04" }, body: JSON.stringify({ model: "claude-x" }) });
            const res = await ctx.fns.node.relay({ req, api: "anthropic" });
            expect(res.status).toBe(200);
            expect(sent["anthropic-beta"]).toBe("claude-code-20250219,oauth-2025-04-20,compact-2026-09-04");
        } finally { globalThis.fetch = realFetch; }
    });
});
