import { test, expect, afterEach, spyOn } from "bun:test";
import discover from "./kimiCodingModels";
import list from "./listModels";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function fixture() {
    let calls = 0;
    const ctx: any = { state: {}, env: {}, fns: { llm: { refreshKimiCode: async () => "test-key" } } };
    const mock = (fn: (url: string, init?: RequestInit) => Promise<Response>) => {
        globalThis.fetch = (async (url, init) => { calls++; return fn(String(url), init); }) as typeof fetch;
    };
    const stale = (account = "default") => { ctx.state.kimiCodingModelCatalog[account].nextAt = 0; };
    const run = (account?: string) => discover(ctx, null, { account });
    return { ctx, mock, stale, run, calls: () => calls };
}
const good = () => Response.json({ data: [{ id: "k3.1-pro" }, { id: "k3" }, { id: "k3" }] });
test("official protocol, dedupe, cached results and concurrent singleflight", async () => {
    const f = fixture();
    f.mock(async (url, init) => {
        expect(url).toBe("https://api.kimi.com/coding/v1/models");
        expect(init?.headers).toEqual({ Authorization: "Bearer test-key" });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return good();
    });
    const results = await Promise.all(Array.from({ length: 20 }, () => f.run()));
    expect(results[0]).toEqual(["kimi-coding:k3.1-pro", "kimi-coding:k3"]);
    expect(f.calls()).toBe(1); await f.run(); expect(f.calls()).toBe(1);
    f.stale(); await f.run(); expect(f.calls()).toBe(2);
});
for (const kind of ["http", "json", "shape", "id", "timeout"]) test(`last-good fallback and cooldown: ${kind}`, async () => {
    const f = fixture(); f.mock(async () => good()); const previous = await f.run(); f.stale();
    f.mock(async () => {
        if (kind === "http") return new Response("", { status: 503 });
        if (kind === "json") return new Response("{broken");
        if (kind === "shape") return Response.json({ models: [] });
        if (kind === "id") return Response.json({ data: [{ id: 123 }] });
        throw new DOMException("timeout", "TimeoutError");
    });
    expect(await f.run()).toEqual(previous); expect(await f.run()).toEqual(previous); expect(f.calls()).toBe(2);
    const first = f.ctx.state.kimiCodingModelCatalog.default.nextAt - Date.now();
    f.stale(); await f.run();
    expect(f.ctx.state.kimiCodingModelCatalog.default.nextAt - Date.now()).toBeGreaterThan(first);
});
for (const status of [401, 403]) test(`auth ${status} clears stale availability`, async () => {
    const f = fixture(); f.mock(async () => good()); await f.run(); f.stale();
    f.mock(async () => new Response("private", { status }));
    expect(await f.run()).toEqual([]); expect(await f.run()).toEqual([]); expect(f.calls()).toBe(2);
});
test("valid empty list replaces stale values; missing credentials do not advertise", async () => {
    const f = fixture(); f.mock(async () => good()); await f.run(); f.stale();
    f.mock(async () => Response.json({ data: [] })); expect(await f.run()).toEqual([]);
    f.stale(); f.ctx.fns.llm.refreshKimiCode = async () => null;
    expect(await f.run()).toEqual([]); expect(f.calls()).toBe(2);
});
test("account credentials and caches are independent", async () => {
    const f = fixture(); const accounts: string[] = [];
    f.ctx.fns.llm.refreshKimiCode = async ({ account }: { account: string }) => { accounts.push(account); return "test-key"; };
    f.mock(async () => good());
    await f.run(); expect(await f.run("personal")).toEqual(["kimi-coding/personal:k3.1-pro", "kimi-coding/personal:k3"]);
    expect(accounts).toEqual(["default", "personal"]); expect(f.calls()).toBe(2);
});
test("timeout is bounded to five seconds", async () => {
    const f = fixture(); const timeout = spyOn(AbortSignal, "timeout");
    try { f.mock(async () => good()); await f.run(); expect(timeout).toHaveBeenCalledWith(5000); }
    finally { timeout.mockRestore(); }
});
test("outer SWR retains other provider behaviour and avoids repeated discovery", async () => {
    const f = fixture(); let discoveries = 0;
    f.ctx.fns.llm.resolveEndpoint = async () => ({ apiKey: "key" });
    f.ctx.fns.llm.kimiCodingModels = async () => { discoveries++; return ["kimi-coding:k3.1-pro"]; };
    f.ctx.fns.settings = { getString: async () => null };
    // Subscription groups follow llm.listAccounts: one Kimi Coding default login.
    f.ctx.fns.llm.listAccounts = async () => [{ provider: "kimi-coding", account: "default", source: "file", needsReconnect: false }];
    f.mock(async () => Response.json({ data: [] }));
    const a = await list(f.ctx, null, { skipNodes: true });
    const b = await list(f.ctx, null, { skipNodes: true });
    expect(a).toEqual(b); expect(discoveries).toBe(1);
    expect(a.kimi).toContain("kimi:kimi-k3"); expect(a.openai).toContain("openai:gpt-5-codex");
    expect(a["kimi-coding"]).toEqual(["kimi-coding:k3.1-pro"]);
});
