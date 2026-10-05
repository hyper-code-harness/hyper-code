import { describe, expect, test } from "bun:test";
import render from "./parkedCard";
import { renderCtx } from "./testRender.entry";

// The real component kit, so a renderer that starts calling another component
// does not take this file down with a mock that never heard of it.
const ctx = await renderCtx();
const NOW = 1_786_900_000_000;
const RESETS_AT = NOW + 3 * 24 * 3_600_000 + 16 * 3_600_000;

const parkedAgent = (over: any = {}) => ({
    id: "iwr",
    model: "codex:gpt-5.6-sol",
    scratchpad: {
        parked: {
            reason: "usage_limit",
            provider: "codex",
            account: "default",
            planType: "prolite",
            resetsAt: RESETS_AT,
            wakeAt: RESETS_AT + 60_000,
            ...over,
        },
    },
}) as any;

const MODELS = { codex: ["codex:gpt-5.6-sol"], openai: ["openai:gpt-5-codex"], "kimi-coding": ["kimi-coding:k3"] };

describe("ui.parkedCard", () => {
    test("renders nothing for an agent that is not parked", () => {
        expect(render(ctx, null, { agent: { id: "a", scratchpad: {} } as any })).toBe("");
    });

    test("states the plan and when the quota comes back", () => {
        const html = render(ctx, null, { agent: parkedAgent(), models: MODELS, now: NOW });
        expect(html).toContain("Parked · usage limit");
        expect(html).toContain("codex");
        expect(html).toContain("prolite");
        expect(html).toContain("3д 16ч");
    });

    test("offers the same-family alternative billed differently", () => {
        const html = render(ctx, null, { agent: parkedAgent(), models: MODELS, now: NOW });
        expect(html).toContain("openai:gpt-5-codex");
        expect(html).toContain('name="scope" value="provider"');
    });

    test("the current model cannot be re-selected", () => {
        const html = render(ctx, null, { agent: parkedAgent(), models: MODELS, now: NOW });
        expect(html).toContain('<option value="codex:gpt-5.6-sol" disabled>');
    });

    test("a named account is shown, the default one is not", () => {
        expect(render(ctx, null, { agent: parkedAgent({ account: "personal" }), models: MODELS, now: NOW })).toContain("codex/personal");
        expect(render(ctx, null, { agent: parkedAgent(), models: MODELS, now: NOW })).not.toContain("codex/default");
    });

    test("both ways out are offered", () => {
        const html = render(ctx, null, { agent: parkedAgent(), models: MODELS, now: NOW });
        expect(html).toContain("/agent/iwr/unpark");
        expect(html).toContain("Wake now");
        expect(html).toContain("Cancel parking");
    });

    test("an unknown reset time is admitted, not invented", () => {
        const html = render(ctx, null, { agent: parkedAgent({ resetsAt: null, wakeAt: null }), models: MODELS, now: NOW });
        expect(html).toContain("время неизвестно");
    });
});
