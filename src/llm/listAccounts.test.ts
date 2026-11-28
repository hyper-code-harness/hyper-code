import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import list from "./listAccounts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
function fixture() {
    const home = mkdtempSync(`${tmpdir()}/account-list-mock-`); cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    let now = 1_000; const clock = spyOn(Date, "now").mockImplementation(() => now); cleanup.push(() => clock.mockRestore());
    const rows: any[] = [{ account: "managed", label: "Managed test", expires_at: 100_000 }];
    const usage: any[] = []; const health: any[] = [];
    let selects = 0, probes = 0;
    const ctx: any = { state: {}, env: { HOME: home, USER: "mock" }, fns: {
        llm: { usageOverview: async () => usage, accountAuthHealth: async () => health,
            accountCredentialExists: async ({ account }: any) => { probes++; return account === "default"; } },
        procs: { db: { select: async () => { selects++; return rows; } } }, node: { list: async () => [] },
    } };
    return { ctx, home, rows, usage, health, advance: (ms: number) => { now += ms; }, counts: () => ({ selects, probes }) };
}
test("inventory singleflight suppresses repeated probes while quota and health stay fresh", async () => {
    const f = fixture();
    const all = await Promise.all(Array.from({ length: 20 }, () => list(f.ctx, null, { provider: "claude-code" })));
    expect(f.counts()).toEqual({ selects: 1, probes: 1 }); expect(all[0]!.length).toBe(2);
    f.usage.push({ provider: "claude-code", account: "default", usedPercent: 100, parkedAgents: 1 });
    f.health.push({ provider: "anthropic-oauth", account: "managed", needsReconnect: true });
    const changed = await list(f.ctx, null, { provider: "claude-code" });
    expect(changed.every((x) => !x.available)).toBe(true); expect(f.counts()).toEqual({ selects: 1, probes: 1 });
    f.advance(5_000); await list(f.ctx, null, { provider: "claude-code" }); expect(f.counts()).toEqual({ selects: 2, probes: 2 });
});
test("false asynchronous probe is not mistaken for a truthy promise; invalidation discovers new slots", async () => {
    const f = fixture(); f.rows.length = 0;
    f.ctx.fns.llm.accountCredentialExists = async () => false;
    expect(await list(f.ctx, null, { provider: "claude-code" })).toEqual([]);
    mkdirSync(`${f.home}/.hyper/accounts/claude-code/work`, { recursive: true });
    f.ctx.fns.llm.accountCredentialExists = async ({ account }: any) => account === "work";
    expect(await list(f.ctx, null, { provider: "claude-code" })).toEqual([]);
    delete f.ctx.state.llm.accountInventoryCache;
    expect((await list(f.ctx, null, { provider: "claude-code" })).map((x) => x.account)).toEqual(["work"]);
});
test("cached OAuth expiry is evaluated against each request time and callers cannot mutate inventory", async () => {
    const f = fixture();
    const one = await list(f.ctx, null, { provider: "anthropic-oauth", now: 5_000 }); one[0]!.label = "changed by caller";
    const two = await list(f.ctx, null, { provider: "anthropic-oauth", now: 100_000 });
    expect(two[0]!.label).toBe("Managed test"); expect(two[0]!.available).toBe(false); expect(two[0]!.needsReconnect).toBe(true);
    expect(f.counts().selects).toBe(1);
});
test("old in-flight inventory does not restore invalidated map and query failures are retried", async () => {
    const f = fixture(); let finish!: (value: any[]) => void;
    f.ctx.fns.procs.db.select = () => new Promise<any[]>((resolve) => { finish = resolve; });
    const pending = list(f.ctx, null, { provider: "anthropic-oauth" }); await Promise.resolve(); await Promise.resolve();
    delete f.ctx.state.llm.accountInventoryCache;
    f.ctx.fns.procs.db.select = async () => [];
    expect(await list(f.ctx, null, { provider: "anthropic-oauth" })).toEqual([]);
    finish(f.rows); await pending;
    expect(await list(f.ctx, null, { provider: "anthropic-oauth" })).toEqual([]);
    delete f.ctx.state.llm.accountInventoryCache;
    f.ctx.fns.procs.db.select = async () => { throw new Error("mock database unavailable"); };
    await expect(list(f.ctx, null, { provider: "anthropic-oauth" })).rejects.toThrow("mock database unavailable");
    f.ctx.fns.procs.db.select = async () => f.rows;
    expect((await list(f.ctx, null, { provider: "anthropic-oauth" })).length).toBe(1);
});
