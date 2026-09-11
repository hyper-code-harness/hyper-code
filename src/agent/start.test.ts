import { test, expect, describe, mock } from "bun:test";
import start from "./start";

const mkCtx = () => {
    const save = mock(() => {});
    const emitAgentsChanged = mock(() => {});
    const nextId = mock(() => 'a');
    return {
        state: {},
        env: process.env,
        fns: {
            agent: { nextId },
            session: { save },
            events: { emitAgentsChanged },
        },
    } as unknown as Context;
};

describe("agent.start", () => {
    test("creates agent with default shape", async () => {
        const ctx = mkCtx();
        const agent = await start(ctx, null, { model: "claude-code:claude-opus-5" });
        expect(agent.id).toBe('a');
        expect(agent.model).toBe("claude-code:claude-opus-5");
        expect(agent.systemPrompt).toBe("");
        expect(agent.messages).toEqual([]);
        expect(agent.events).toEqual([]);
        expect(agent.scratchpad).toEqual({});
        expect(agent.isStreaming).toBe(false);
    });

    test("stores agent in ctx.state.agent[id]", async () => {
        const ctx = mkCtx();
        const agent = await start(ctx, null, { model: "x", systemPrompt: "hi" });
        expect((ctx.state as any).agent[agent.id]).toBe(agent);
        expect(agent.systemPrompt).toBe("hi");
    });

    test("multiple agents coexist", async () => {
        const ctx = mkCtx();
        (ctx as any).fns.agent.nextId
            .mockReturnValueOnce('a')
            .mockReturnValueOnce('b');
        const a = await start(ctx, null, { model: "x" });
        const b = await start(ctx, null, { model: "y" });
        expect(a.id).not.toBe(b.id);
        expect(Object.keys((ctx.state as any).agent)).toHaveLength(2);
    });

    test("persists and emits create event", async () => {
        const ctx = mkCtx() as any;
        const agent = await start(ctx, null, { model: "codex:gpt-5.4" });
        expect(ctx.fns.agent.nextId).toHaveBeenCalledTimes(1);
        expect(ctx.fns.session.save).toHaveBeenCalledTimes(1);
        expect(ctx.fns.session.save).toHaveBeenCalledWith({ agent });
        expect(ctx.fns.events.emitAgentsChanged).toHaveBeenCalledTimes(1);
        expect(ctx.fns.events.emitAgentsChanged).toHaveBeenCalledWith({ agentId: agent.id, reason: "create" });
    });
});
