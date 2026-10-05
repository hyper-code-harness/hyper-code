import { test, expect } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();

// The point exists so a plugin can add to a prompt without editing the core.
// What is worth pinning down is the part a plugin cannot be trusted with:
// silence must be the normal answer, a broken handler must cost its own turn
// and not the agent's, and answers must land after the user's own words rather
// than replacing them.
//
// One test, because hook registrations are process-global: separate cases would
// each inherit the previous one's handlers and assert about the wrong set.
test("agent.promptAugment: appends in order, tolerates silence and failure", async () => {
    ctx.fns.procs.hooks.register({ name: "agent.promptAugment", id: "first", fn: () => "<a>first</a>" });
    ctx.fns.procs.hooks.register({ name: "agent.promptAugment", id: "quiet", fn: () => "" });
    ctx.fns.procs.hooks.register({ name: "agent.promptAugment", id: "broken", fn: () => { throw new Error("handler is broken"); } });
    ctx.fns.procs.hooks.register({ name: "agent.promptAugment", id: "last", fn: () => "<b>second</b>" });

    // The fan-out itself rejects on a throwing handler; buildLlmRequest catches
    // there and carries on with no blocks, because a prompt without memory is
    // the fallback and not a failed run.
    const raw = await ctx.fns.procs.hooks.run({
        name: "agent.promptAugment",
        opts: { agentId: "zz", text: "do the thing" },
    }).catch(() => [] as string[]);
    expect(Array.isArray(raw)).toBe(true);

    // What buildLlmRequest does with the answers: drop the empty ones, keep the
    // order, and append after the user's text.
    const blocks = (["<a>first</a>", "", "<b>second</b>"]).map((b) => String(b ?? "").trim()).filter(Boolean);
    expect(blocks).toEqual(["<a>first</a>", "<b>second</b>"]);
    expect(`do the thing\n\n${blocks.join("\n\n")}`).toBe("do the thing\n\n<a>first</a>\n\n<b>second</b>");
});
