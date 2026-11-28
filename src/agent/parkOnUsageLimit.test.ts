import { expect, test } from "bun:test";
import parkOnUsageLimit from "./parkOnUsageLimit";

// Unit-only context prevents parking real agents or scheduling real wakes.
async function mkTestCtx(): Promise<any> {
    const registry: any = { agent: { parkOnUsageLimit }, procs: { db: {} }, jobs: {}, session: {}, events: {}, ui: {}, llm: {} };
    const ctx: any = { state: { registry }, env: {} };
    const proxy = (obj: any): any => new Proxy({}, { get: (_t, key) => typeof obj[key] === "function"
        ? (opts: any) => obj[key](ctx, null, opts) : proxy(obj[key]) });
    ctx.fns = proxy(registry);
    return ctx;
}

for (const pool of [true, false]) test(`parking ${pool ? "whole Claude pool" : "one credential"} with isolated stubs`, async () => {
    const ctx: any = await mkTestCtx();
    const reg = ctx.state.registry;
    const rows = [
        { id: "a", model: "claude-code:opus" },
        { id: "b", model: "claude-code/work:sonnet" },
        { id: "c", model: "anthropic-oauth/personal:opus" },
        { id: "d", model: "anthropic:opus" },
        { id: "e", model: "codex:gpt" },
        { id: "f", model: "hyper/remote:claude-code:opus" },
    ];
    const scheduled: any[] = [], recorded: any[] = [], updates: any[] = [], events: any[] = [];
    const scratchpads: Record<string, any> = {};
    reg.procs.db.select = async () => rows;
    reg.procs.db.run = async (_c: any, _s: any, o: any) => { updates.push(o); };
    reg.jobs.schedule = async (_c: any, _s: any, o: any) => { scheduled.push(o); return { id: `wake-${o.agentId}` }; };
    reg.session.mutateScratchpad = async (_c: any, _s: any, o: any) => {
        const scratchpad = scratchpads[o.id] ??= {};
        return { result: o.mutate(scratchpad), scratchpad };
    };
    reg.session.appendEvent = async (_c: any, _s: any, o: any) => { events.push(o); };
    reg.events.refreshAgentMeta = () => {};
    reg.ui.notify = async () => {};
    reg.llm.recordUsage = async (_c: any, _s: any, o: any) => { recorded.push(o); };
    const now = 1_000_000, resetsAt = now + 600_000;
    const info = { provider: pool ? "claude-pool" : "claude-code", account: pool ? "default" : "work", kind: "usage_limit", message: "spent", resetsAt, retryable: false };
    const result = await ctx.fns.agent.parkOnUsageLimit({ info, now });
    const ids = pool ? ["a", "b", "c"] : ["b"];
    expect(result.parked).toEqual(ids);
    expect(scheduled.map(o => o.agentId)).toEqual(ids);
    expect(events.map(o => o.id)).toEqual(ids);
    expect(updates).toHaveLength(ids.length);
    for (const id of ids) {
        expect(scratchpads[id].parked.provider).toBe(info.provider);
        expect(scratchpads[id].parked.resetsAt).toBe(resetsAt);
        expect(scratchpads[id].parked.wakeAt).toBeGreaterThanOrEqual(resetsAt + 60_000);
    }
    expect(recorded).toHaveLength(pool ? 0 : 1);
    if (!pool) expect(recorded[0]).toMatchObject({ provider: "claude-code", account: "work", spent: true, resetsAt });
});
