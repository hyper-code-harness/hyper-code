import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import dial from "../ui/usageDial";

const NOW = 1_786_900_000_000;
const escCtx: any = {
    fns: {
        procs: { ui: { escape: ({ text }: any) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)) } },
        ui: { modelLogo: ({ model }: any) => `<span data-logo="${model}"></span>` },
    },
};

describe("llm.recordUsage", () => {
    test("reads Anthropic unified headers into both windows", async () => {
        const ctx: any = await mkTestCtx();
        const snapshot = await ctx.fns.llm.recordUsage({
            provider: "claude-code",
            headers: {
                "anthropic-ratelimit-unified-5h-utilization": "0.784",
                "anthropic-ratelimit-unified-5h-reset": String(Math.floor((NOW + 3_600_000) / 1000)),
                "anthropic-ratelimit-unified-7d-utilization": "0.41",
                "anthropic-ratelimit-unified-7d-reset": String(Math.floor((NOW + 5 * 86_400_000) / 1000)),
            },
            now: NOW,
        });
        expect(snapshot.windows.primary).toMatchObject({ usedPercent: 78.4, windowMinutes: 300 });
        expect(snapshot.windows.secondary).toMatchObject({ usedPercent: 41, windowMinutes: 10080 });
        expect(snapshot.account).toBe("default");
    });

    test("the Codex stream payload supersedes the bare percent header", async () => {
        const ctx: any = await mkTestCtx();
        const snapshot = await ctx.fns.llm.recordUsage({
            provider: "codex",
            headers: { "x-codex-primary-used-percent": "12.5" },
            rateLimits: { primary: { used_percent: 87.2, window_minutes: 300, resets_at: Math.floor((NOW + 7_200_000) / 1000) } },
            now: NOW,
        });
        expect(snapshot.windows.primary).toMatchObject({ usedPercent: 87.2, windowMinutes: 300 });
        expect(snapshot.source).toBe("stream");
    });

    test("reads xAI token/request capacity into a sidebar pressure ring", async () => {
        const ctx: any = await mkTestCtx();
        const snapshot = await ctx.fns.llm.recordUsage({
            provider: "xai",
            headers: {
                "x-ratelimit-limit-tokens": "1000",
                "x-ratelimit-remaining-tokens": "250",
                "x-ratelimit-limit-requests": "100",
                "x-ratelimit-remaining-requests": "90",
            },
            now: NOW,
        });
        expect(snapshot.windows.primary).toMatchObject({ usedPercent: 75, windowMinutes: 1 });
    });


    test("a response carrying no quota information records nothing", async () => {
        const ctx: any = await mkTestCtx();
        expect(await ctx.fns.llm.recordUsage({ provider: "openai", headers: {}, now: NOW })).toBeNull();
    });

    test("spent=true pins the window to 100% with its reset moment", async () => {
        const ctx: any = await mkTestCtx();
        const resetsAt = NOW + 3 * 86_400_000;
        const snapshot = await ctx.fns.llm.recordUsage({ provider: "codex", spent: true, resetsAt, planType: "prolite", now: NOW });
        expect(snapshot.windows.primary).toMatchObject({ usedPercent: 100, resetsAt });
        expect(snapshot.planType).toBe("prolite");
        expect(snapshot.source).toBe("error");
    });

    test("crossing the alert threshold warns once, not on every request", async () => {
        const ctx: any = await mkTestCtx();
        const toasts: any[] = [];
        // Test registry entries are called raw: (ctx, session, opts).
        ctx.fns.ui.notify = async (_c: any, _s: any, o: any) => { toasts.push(o ?? _c); };
        const resets = Math.floor((NOW + 3_600_000) / 1000);

        await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: 70, resets_at: resets } }, now: NOW });
        expect(toasts).toHaveLength(0);

        await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: 87, resets_at: resets } }, now: NOW });
        await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: 91, resets_at: resets } }, now: NOW });
        expect(toasts).toHaveLength(1);
        expect(toasts[0].message).toContain("87%");

        // The window rolled over: the next approach deserves its own warning.
        const later = NOW + 4_000_000;
        await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: 88, resets_at: Math.floor((later + 3_600_000) / 1000) } }, now: later });
        expect(toasts).toHaveLength(2);
    });

    test("accounts of one provider are tracked separately", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.llm.recordUsage({ provider: "codex", account: "work", rateLimits: { primary: { used_percent: 90 } }, now: NOW });
        await ctx.fns.llm.recordUsage({ provider: "codex", account: "personal", rateLimits: { primary: { used_percent: 10 } }, now: NOW });
        const overview = await ctx.fns.llm.usageOverview({ now: NOW });
        expect(overview.map((e: any) => [e.account, e.usedPercent])).toEqual([["work", 90], ["personal", 10]]);
    });
});

describe("llm.usageOverview", () => {
    test("reports the worst window, not the flattering one", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.llm.recordUsage({
            provider: "codex",
            rateLimits: {
                primary: { used_percent: 96, resets_at: Math.floor((NOW + 3_600_000) / 1000) },
                secondary: { used_percent: 12, resets_at: Math.floor((NOW + 5 * 86_400_000) / 1000) },
            },
            now: NOW,
        });
        const [entry] = await ctx.fns.llm.usageOverview({ now: NOW });
        expect(entry.usedPercent).toBe(96);
        expect(entry.tone).toBe("error");
    });

    test("a window whose reset has passed is dropped rather than shown stale", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.llm.recordUsage({
            provider: "codex",
            rateLimits: { primary: { used_percent: 100, resets_at: Math.floor((NOW - 1000) / 1000) } },
            now: NOW - 10_000,
        });
        const [entry] = await ctx.fns.llm.usageOverview({ now: NOW });
        expect(entry.usedPercent).toBeNull();
        expect(entry.tone).toBe("neutral");
    });

    test("the thresholds are settings, not constants", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: 76 } }, now: NOW });

        // Default: red from 75%.
        expect((await ctx.fns.llm.usageOverview({ now: NOW }))[0].tone).toBe("error");

        await ctx.fns.settings.set({ module: "llm", scopeType: "global", key: "usageAlertPercent", value: 90 });
        await ctx.fns.settings.set({ module: "llm", scopeType: "global", key: "usageWarnPercent", value: 80 });
        expect((await ctx.fns.llm.usageOverview({ now: NOW }))[0].tone).toBe("neutral");
    });

    test("includes an active xAI agent in the sidebar before a snapshot exists", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.agent.start({ model: "xai:grok-4.6" });
        const entry = (await ctx.fns.llm.usageOverview({ now: NOW })).find((e: any) => e.provider === "xai");
        expect(entry).toBeDefined();
        expect(entry.model).toBe("xai:grok-4.6");
        expect(entry.usedPercent).toBeNull();
    });


    test("counts the agents parked on each credential", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.agent.parkOnUsageLimit({
            info: { kind: "usage_limit", provider: "mock", account: "default", message: "spent", retryable: false, resetsAt: NOW + 86_400_000 } as any,
            now: NOW,
        });
        const entry = (await ctx.fns.llm.usageOverview({ now: NOW })).find((e: any) => e.provider === "mock");
        expect(entry.parkedAgents).toBe(2);
        expect(entry.usedPercent).toBe(100);
    });
});

describe("ui.usageDial", () => {
    const entry = (over: any = {}) => ({ provider: "codex", account: "default", label: "codex", model: "codex:gpt-5.6-sol", usedPercent: 78, resetsAt: NOW + 7_200_000, planType: "prolite", parkedAgents: 0, tone: "warning", ...over });

    test("nothing recorded renders nothing", () => {
        expect(dial(escCtx, null, { entries: [], now: NOW })).toBe("");
    });

    test("the ring fill is proportional to the spent quota", () => {
        const html = dial(escCtx, null, { entries: [entry({ usedPercent: 50 })], now: NOW });
        // Half of the r=12 circumference (75.4). The ring IS the number — there
        // is no digit to read in a 40px-wide bar.
        expect(html).toContain('stroke-dasharray="37.7 75.4"');
        expect(html).not.toMatch(/>\s*50\s*</);
    });

    test("each ring carries its provider mark", () => {
        const html = dial(escCtx, null, { entries: [entry({ model: "kimi-coding:k3" })], now: NOW });
        expect(html).toContain('data-logo="kimi-coding:k3"');
    });

    test("crossing the thresholds changes the colour", () => {
        expect(dial(escCtx, null, { entries: [entry({ usedPercent: 20, tone: "neutral" })], now: NOW })).toContain("text-faint");
        expect(dial(escCtx, null, { entries: [entry({ usedPercent: 70, tone: "warning" })], now: NOW })).toContain("text-warning");
        expect(dial(escCtx, null, { entries: [entry({ usedPercent: 92, tone: "error" })], now: NOW })).toContain("text-error");
    });

    test("a parked credential shows the pause mark and says how many wait", () => {
        const html = dial(escCtx, null, { entries: [entry({ usedPercent: 100, tone: "error", parkedAgents: 14 })], now: NOW });
        expect(html).toContain("ph-pause");
        expect(html).toContain("14 агент(ов) припарковано");
    });

    test("the tooltip interprets the number instead of just stating it", () => {
        const calm = dial(escCtx, null, { entries: [entry({ usedPercent: 20, tone: "neutral" })], now: NOW });
        expect(calm).toContain("осталось 80%");
        expect(calm).toContain("запаса хватает");
        expect(calm).toContain("сброс через 2ч 0м");

        const hot = dial(escCtx, null, { entries: [entry({ usedPercent: 78, tone: "error" })], now: NOW });
        expect(hot).toContain("осталось 22%");
        expect(hot).toContain("стоит переключить модель");
    });

    test("no data draws an empty ring instead of a fake zero", () => {
        const html = dial(escCtx, null, { entries: [entry({ usedPercent: null, tone: "neutral" })], now: NOW });
        expect(html).not.toContain("stroke-dasharray");
        expect(html).toContain("ещё нет данных");
    });
});
