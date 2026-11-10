import { test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// agent.basePrompt: no answer → the system prompt is byte-for-byte unchanged;
// the first non-null answer replaces only the base, the per-agent prompt and
// the runtime context still follow; a broken or hanging handler is skipped.
// One test: hook registrations are process-global.
test("agent.basePrompt replaces only the base, and silence changes nothing", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test", systemPrompt: "PER-AGENT-RULE", meta: { profile: "support" } });
    expect(agent.meta).toEqual({ profile: "support" });

    const before = await ctx.fns.agent.fullSystemPrompt({ agent });
    const base = (await ctx.fns.agent.systemPromptBase({ agent })).text;
    expect(before.startsWith(base)).toBe(true);

    const handlers = (ctx.state.procs.hooks.handlers ??= {});
    const saved = handlers["agent.basePrompt"];
    try {
        // Only silent answers: identical output.
        handlers["agent.basePrompt"] = new Map<string, Function>([
            ["quiet", () => null],
            ["undef", () => undefined],
        ]);
        expect(await ctx.fns.agent.fullSystemPrompt({ agent })).toBe(before);

        const seen: any[] = [];
        handlers["agent.basePrompt"] = new Map<string, Function>([
            ["broken", () => { throw new Error("boom"); }],
            ["quiet", () => null],
            ["support", (_c: any, _s: any, o: any) => { seen.push(o); return o.meta?.profile === "support" ? "YOU ARE SUPPORT" : null; }],
            ["late", () => "NEVER"],
        ]);
        const after = await ctx.fns.agent.fullSystemPrompt({ agent });
        expect(seen).toEqual([{ agentId: agent.id, meta: { profile: "support" } }]);
        expect(after.startsWith("YOU ARE SUPPORT\n\n")).toBe(true);
        expect(after).not.toContain("NEVER");
        expect(after).toContain("PER-AGENT-RULE");
        expect(after).toContain(agent.id);
        // Everything after the base is unchanged.
        expect(after.slice("YOU ARE SUPPORT".length)).toBe(before.slice(base.length));
    } finally {
        if (saved) handlers["agent.basePrompt"] = saved; else delete handlers["agent.basePrompt"];
    }
});

test("agent.meta survives session.save and session.load; none loads as null", async () => {
    const ctx: any = await mkTestCtx();
    const withMeta = await ctx.fns.agent.start({ model: "mock:test", meta: { profile: "x", n: 1 } });
    const plain = await ctx.fns.agent.start({ model: "mock:test" });
    expect(plain.meta).toBeUndefined();
    delete ctx.state.agent[withMeta.id];
    delete ctx.state.agent[plain.id];
    const a = await ctx.fns.session.load({ id: withMeta.id });
    const b = await ctx.fns.session.load({ id: plain.id });
    expect(a.meta).toEqual({ profile: "x", n: 1 });
    expect(b.meta).toBeNull();
});
