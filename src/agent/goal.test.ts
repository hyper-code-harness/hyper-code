import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent goal loop", () => {
    test("continues after an unmet goal and stops when achieved", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        agent.scratchpad.mockLLM = { turns: [{ text: "first answer" }, { text: "final answer" }] };
        await ctx.fns.agent.setGoal({ id: agent.id, statement: "finish it", iterations: 3 });
        let checks = 0;
        ctx.state.registry.agent.checkGoal = async () => ++checks === 1
            ? { status: "continue", reason: "not verified", nextStep: "verify" }
            : { status: "achieved", reason: "verified", evidence: ["test passed"] };

        await ctx.fns.agent.run({ agent, userText: "go" });
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(messages.map((m: any) => m.message_type ?? "message")).toContain("goal_feedback");
        expect(messages.filter((m: any) => m.role === "assistant").map((m: any) => m.content)).toEqual(["first answer", "final answer"]);
        expect((await ctx.fns.session.getEvents({ id: agent.id })).some((e: any) => e.type === "goal_check" && e.messageIdx != null)).toBe(true);
        expect(agent.goal.status).toBe("achieved");
        expect(agent.goal.checks).toHaveLength(2);
        expect(agent.goal.enabled).toBe(false);
    });

    test("respects selected iteration limit", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        agent.scratchpad.mockLLM = { defaultText: "trying" };
        await ctx.fns.agent.setGoal({ id: agent.id, statement: "impossible", iterations: 2 });
        let checks = 0;
        ctx.state.registry.agent.checkGoal = async () => ({ status: "continue", reason: `not yet ${++checks}`, nextStep: `step ${checks}` });
        await ctx.fns.agent.run({ agent, userText: "go" });
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(messages.filter((m: any) => m.message_type === "goal_feedback")).toHaveLength(3);
        expect(messages.filter((m: any) => m.role === "assistant")).toHaveLength(3);
        expect(agent.goal.status).toBe("limit_reached");
        expect(agent.goal.checks.at(-1).status).toBe("limit_reached");
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.at(-1)).toMatchObject({ type: "goal_check", status: "limit_reached" });
    });
    test("an agent that worked for a long time before its first answer still gets its continuations", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        // Its first step is a tool call that takes twenty minutes; then it answers, twice.
        const realNow = Date.now;
        let skew = 0;
        Date.now = () => realNow() + skew;
        try {
            ctx.fns.files.read = async () => { skew += 20 * 60_000; return "FILE"; };
            agent.scratchpad.mockLLM = { turns: [{ text: "working", toolCalls: [{ name: "read", args: { path: "x" } }] }, { text: "first answer" }, { text: "second answer" }] };
            await ctx.fns.agent.setGoal({ id: agent.id, statement: "finish it", iterations: 3 });
            let checks = 0;
            // The second stretch of work is long too.
            ctx.state.registry.agent.checkGoal = async () => { skew += 20 * 60_000; return ++checks === 1 ? { status: "continue", reason: "not verified", nextStep: "verify" } : { status: "achieved", reason: "verified" }; };
            await ctx.fns.agent.run({ agent, userText: "go" });
        } finally { Date.now = realNow; }
        const events = (await ctx.fns.session.getEvents({ id: agent.id })).filter((e: any) => e.type === "goal_check");
        // The first check lets it continue (1 of 3 used), the second finds the goal reached — the clock stops neither.
        expect(events.map((e: any) => `${e.status} ${e.iteration}/${e.maxIterations}`)).toEqual(["continue 1/3", "achieved 1/3"]);
        expect(agent.goal.status).toBe("achieved");
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(messages.filter((m: any) => m.role === "assistant" && !m.tool_calls?.length).map((m: any) => m.content)).toEqual(["first answer", "second answer"]);
    });

    test("a checker that repeats the same feedback stops the loop instead of spending the whole budget", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        agent.scratchpad.mockLLM = { defaultText: "trying" };
        await ctx.fns.agent.setGoal({ id: agent.id, statement: "impossible", iterations: 5 });
        ctx.state.registry.agent.checkGoal = async () => ({ status: "continue", reason: "still not done", nextStep: "do it" });
        await ctx.fns.agent.run({ agent, userText: "go" });
        const events = (await ctx.fns.session.getEvents({ id: agent.id })).filter((e: any) => e.type === "goal_check");
        expect(events.map((e: any) => e.status)).toEqual(["continue", "limit_reached"]);
        expect(events.at(-1).reason).toBe("Goal checker repeated the same feedback. Last check: still not done");
    });

    test("does not check goal before executing tool calls", async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.files.read = async () => "FILE";
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        agent.scratchpad.mockLLM = { turns: [
            { text: "reading", toolCalls: [{ name: "read", args: { path: "a" } }] },
            { text: "done" },
        ] };
        await ctx.fns.agent.setGoal({ id: agent.id, statement: "read file", iterations: 2 });
        let checks = 0;
        ctx.state.registry.agent.checkGoal = async () => { checks++; return { status: "achieved", reason: "file read" }; };
        await ctx.fns.agent.run({ agent, userText: "go" });
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(messages.some((m: any) => m.role === "tool" && m.content === "FILE")).toBe(true);
        expect(checks).toBe(1);
    });


});
