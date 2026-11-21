import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const now = Date.parse("2026-11-21T12:00:00Z");
const resets = { availableCount: 1, checkedAt: now, credits: [{ id: "weekly", remainingCount: 1, expiresAt: now + 86_400_000 }] };

test("a reset-only Claude response is persisted without inventing quota", async () => {
    const ctx = await mkTestCtx();
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", resetCredits: resets, now });
    const row = (await ctx.fns.llm.usageOverview({ now }))[0];
    expect(row).toMatchObject({ usedPercent: null, resetCredits: resets });
});

test("ordinary model headers preserve reset availability and its check time", async () => {
    const ctx = await mkTestCtx();
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", resetCredits: resets, now });
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", headers: { "anthropic-ratelimit-unified-5h-utilization": "0.2" }, now: now + 1000 });
    expect((await ctx.fns.llm.usageOverview({ now: now + 1000 }))[0]).toMatchObject({ usedPercent: 20, resetCredits: resets });
});

test("an unavailable read clears a stale count rather than pretending there are zero resets", async () => {
    const ctx = await mkTestCtx();
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", resetCredits: resets, now });
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", resetCredits: { availableCount: null, checkedAt: now + 1000, unavailableReason: "surface", credits: [] }, now: now + 1000 });
    expect((await ctx.fns.llm.usageOverview({ now: now + 1000 }))[0]?.resetCredits).toMatchObject({ availableCount: null, credits: [], unavailableReason: "surface" });
});

test("parking keeps exhausted quota but does not hide independent free reset availability", async () => {
    const ctx = await mkTestCtx();
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", spent: true, resetsAt: now + 86_400_000, now: now - 1000 });
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", headers: { "anthropic-ratelimit-unified-5h-utilization": "0.2" }, resetCredits: resets, now });
    expect((await ctx.fns.llm.usageOverview({ now }))[0]).toMatchObject({ usedPercent: 100, resetCredits: resets });
});

test("a delayed pre-reset read cannot restore older reset availability", async () => {
    const ctx = await mkTestCtx();
    const used = { availableCount: 0, checkedAt: now + 2000, credits: [] };
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", resetCredits: used, now: now + 2000 });
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", headers: { "anthropic-ratelimit-unified-5h-utilization": "0.2" }, resetCredits: resets, now });
    expect((await ctx.fns.llm.usageOverview({ now: now + 2000 }))[0]?.resetCredits).toEqual(used);
});

test("post-reset failed telemetry preserves a concurrent quota failure", async () => {
    const ctx = await mkTestCtx();
    await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account: "test", spent: true, resetsAt: now + 86400000, now });
    ctx.state.registry.llm.getAnthropicOAuthToken = async () => { throw new Error("unavailable"); };
    const result = await ctx.fns.llm.refreshUsage({ accounts: [{ provider: "anthropic-oauth", account: "test" }], maxAgeMs: 0, preserveOnFailure: true, now });
    expect(result[0]?.status).toBe("failed");
    expect((await ctx.fns.llm.usageOverview({ now }))[0]?.usedPercent).toBe(100);
});
