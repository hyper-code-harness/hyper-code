import { test, expect } from "bun:test";
import checkGoal from "./checkGoal";

function world(reply: (opts: any) => { text: string }) {
    const calls: any[] = [];
    const ctx: any = { fns: {
        session: { getFullMessages: async () => [{ role: "user", content: "do it" }, { role: "assistant", content: "done" }] },
        llm: { call: async (opts: any) => { calls.push(opts); return reply(opts); } },
    } };
    const agent: any = { id: "aa", model: "anthropic:some-reasoning-model", goal: { enabled: true, statement: "ship it" } };
    return { ctx, agent, calls };
}

// A reasoning model thinks out of the same output limit as its answer. With llm.call's default (2048) the thinking
// used all of it and the verdict came back empty: "goal checker failed: JSON Parse error: Unexpected EOF".
test("the goal check asks for room to think AND answer", async () => {
    const VERDICT = '{"status":"achieved","reason":"all five items have live results","evidence":["a","b"]}';
    // A model that needs 3000 tokens of thinking before it can write its verdict.
    const w = world(opts => ({ text: (opts.max_tokens ?? 2048) > 3000 ? VERDICT : "" }));
    expect(await checkGoal(w.ctx, null, { agent: w.agent, candidateAnswer: "done" }))
        .toEqual({ status: "achieved", reason: "all five items have live results", nextStep: undefined, evidence: ["a", "b"] });
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].max_tokens).toBeGreaterThanOrEqual(8192);
    expect(w.calls[0]).toMatchObject({ model: "anthropic:some-reasoning-model", sessionId: "aa", temperature: 0 });
});

test("an answer that is not a verdict is reported as a failed check, and a disabled goal is not checked at all", async () => {
    const empty = world(() => ({ text: "" }));
    expect(await checkGoal(empty.ctx, null, { agent: empty.agent, candidateAnswer: "x" })).toMatchObject({ status: "blocked", reason: expect.stringContaining("goal checker failed") });
    const fenced = world(() => ({ text: '```json\n{"status":"continue","reason":"not yet","nextStep":"run the tests"}\n```' }));
    expect(await checkGoal(fenced.ctx, null, { agent: fenced.agent, candidateAnswer: "x" })).toMatchObject({ status: "continue", nextStep: "run the tests" });
    const off = world(() => ({ text: "" }));
    off.agent.goal.enabled = false;
    expect(await checkGoal(off.ctx, null, { agent: off.agent, candidateAnswer: "x" })).toEqual({ status: "achieved", reason: "goal disabled" });
    expect(off.calls).toHaveLength(0);
});
