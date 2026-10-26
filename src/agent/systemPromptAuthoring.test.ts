import { expect, test } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();

// The authoring rules themselves live in docs/agent-handbook.md: spelling them
// out in the prompt cost every request ~1 KB for a rule that only matters while
// actually writing a function. What the prompt must keep is the pointer.
test("every newly assembled agent prompt points at the handbook and the lookup functions", async () => {
    const prompt = await ctx.fns.agent.fullSystemPrompt({ agent: { id: "new", model: "mock:test", systemPrompt: "", messages: [], events: [], scratchpad: {} } as any });
    expect(prompt).toContain("docs/agent-handbook.md");
    expect(prompt).toContain("ctx.fns.runtime.docs.search");
    expect(prompt).toContain("ctx.fns.code.slice");
});

test("the handbook still carries the runtime authoring rules the prompt no longer repeats", async () => {
    const handbook = await Bun.file(new URL("../../docs/agent-handbook.md", import.meta.url)).text();
    expect(handbook).toContain("ctx.fns.procs.dev.createFunction");
    expect(handbook).toContain("ctx.fns.runtime.docs.validate");
    expect(handbook).toContain("strict: true, typecheck: true");
    expect(handbook).toContain("Do not hand-write keyword lists");
});
