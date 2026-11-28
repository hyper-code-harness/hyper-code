import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const NOW = 1_786_900_000_000;

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

    test("quota pressure stays recorded without threshold toasts, including later windows", async () => {
        const ctx: any = await mkTestCtx();
        const toasts: any[] = [];
        ctx.state.registry.ui.notify = async (_c: any, _s: any, o: any) => { toasts.push(o); };
        const resets = Math.floor((NOW + 3_600_000) / 1000);
        for (const percent of [70, 87, 91, 99]) {
            await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: percent, resets_at: resets } }, now: NOW });
            expect((await ctx.fns.llm.usageOverview({ now: NOW }))[0].usedPercent).toBe(percent);
        }
        const later = NOW + 4_000_000;
        await ctx.fns.llm.recordUsage({ provider: "codex", rateLimits: { primary: { used_percent: 88, resets_at: Math.floor((later + 3_600_000) / 1000) } }, now: later });
        expect(toasts).toHaveLength(0);
        const exhausted = await ctx.fns.llm.recordUsage({ provider: "codex", spent: true, resetsAt: later + 3_600_000, now: later });
        expect(exhausted).toMatchObject({ source: "error", windows: { primary: { usedPercent: 100 } } });
        expect((await ctx.fns.llm.usageOverview({ now: later }))[0].usedPercent).toBe(100);
        // Suppress only automatic quota thresholds, never global notification delivery.
        await ctx.fns.ui.notify({ level: "error", message: "A different failure" });
        expect(toasts).toHaveLength(1);
        expect(toasts[0].message).toBe("A different failure");
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
});

describe("ui.usageDial", () => {
    const entry = (over: any = {}) => ({ provider: "codex", account: "default", label: "codex", model: "codex:gpt-5.6-sol", usedPercent: 78, resetsAt: NOW + 7_200_000, planType: "prolite", parkedAgents: 0, tone: "warning", ...over });
    const render = async (entries: any[]) => {
        const ctx = await mkTestCtx();
        return ctx.fns.ui.usageDial({ entries, now: NOW });
    };

    test("nothing recorded renders nothing", async () => {
        expect(await render([])).toBe("");
    });

    test("one proportional ring represents the highest usage without visible digits", async () => {
        const html = await render([entry({ usedPercent: 20 }), entry({ account: "work", label: "codex · work", usedPercent: 50 })]);
        expect(html.match(/class="w-ring"/g)).toHaveLength(1);
        expect(html).toContain('stroke-dasharray="50.0 100"');
        expect(html).toContain("highest recorded usage: codex · work");
        const trigger = html.split('</button>')[0];
        expect(trigger).not.toMatch(/>\s*50(?:% used)?\s*</);
        expect(html.match(/data-usage-account/g)).toHaveLength(2);
    });

    test("ordinary percentages stay neutral even when upstream tone is warning or error", async () => {
        for (const usedPercent of [20, 70, 78, 92, 99.99]) {
            const html = await render([entry({ usedPercent, tone: "error" })]);
            expect(html).toContain('class="w-ring" data-tone="neutral"');
            expect(html).not.toMatch(/data-tone="(?:warning|danger)"|data-state="error"|text-error|text-warning/);
            expect(html).not.toContain("quota exhausted");
            expect(html).not.toContain("100% used");
        }
    });

    test("100 percent and parked credentials remain visibly blocked", async () => {
        const spent = await render([entry({ usedPercent: 100, tone: "neutral" })]);
        expect(spent).toContain('data-tone="danger"');
        expect(spent).toContain('data-state="error"');
        expect(spent).toContain("quota exhausted");
        const parked = await render([entry({ usedPercent: 95 }), entry({ label: "blocked account", usedPercent: null, parkedAgents: 14 })]);
        expect(parked).toContain('data-state="error"');
        expect(parked).toContain("ph-pause");
        expect(parked).toContain("14 agent(s) parked");
        expect(parked.split('</button>')[0]).toContain("blocked account");
    });

    test("hover and click expose usage, reset and all accounts without redirecting the trigger", async () => {
        const html = await render([entry()]);
        expect(html).toContain("78% used");
        expect(html).toContain("22% remaining");
        expect(html).toContain("resets in 2h 0m");
        expect(html).toContain(new Date(NOW + 7_200_000).toLocaleString());
        expect(html).toContain('popovertarget="llm-usage-popup"');
        expect(html).toContain('id="llm-usage-popup" popover');
        expect(html).toContain('role="dialog" aria-label="Subscription quota"');
        expect(html).toContain('href="/llms"');
        expect(html).not.toContain("consider switching models");
    });

    test("missing quota/reset is honest rather than a fake zero", async () => {
        const html = await render([entry({ usedPercent: null, resetsAt: null })]);
        expect(html).not.toContain("stroke-dasharray");
        expect(html).not.toContain("0% used");
        expect(html).toContain("usage unavailable");
        expect(html).toContain("no data yet");
        expect(html).toContain("reset time unavailable");
    });

    test("expired reset does not claim a future countdown and account text is escaped", async () => {
        const html = await render([entry({ label: '<img src=x onerror="bad">', planType: "<script>bad</script>", resetsAt: NOW - 1 })]);
        expect(html).toContain("reset due — awaiting fresh usage");
        expect(html).not.toContain("resets in 0m");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;img");
    });

    test("the shipped Dock entry uses cached snapshots and the existing live usage route", async () => {
        const ctx = await mkTestCtx();
        const item = ctx.state.dock.items["llms.usage"];
        expect(item).toMatchObject({ label: "Subscription quota", zone: "bottom" });
        ctx.state.registry.llm.usageOverview = async () => [entry()];
        ctx.state.registry.llm.refreshUsage = async () => { throw new Error("provider I/O on shell path"); };
        const html = await item.render(ctx, null);
        expect(html).toContain('hx-get="/llms/usage"');
        expect(html).toContain('hx-trigger="load, hyper-live, every 60s"');
        expect(html).toContain('hx-target="this"');
        expect(html).toContain('data-live-topic="llm-usage"');
        // The Dock hides entries without a visible railItem; retain its standard widget.
        expect(html).toContain('class="w-rail-item"');
        ctx.state.registry.llm.usageOverview = async () => [];
        const empty = await item.render(ctx, null);
        expect(empty).toContain('data-live-topic="llm-usage"');
        expect(empty).not.toContain('class="w-rail-item"');
    });
});
