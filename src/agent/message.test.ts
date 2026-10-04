import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function pair(ctx: any) {
    const a = await ctx.fns.agent.start({ model: "mock:echo" });
    a.title = "Researcher";
    await ctx.fns.session.save({ agent: a });
    const b = await ctx.fns.agent.start({ model: "mock:echo" });
    await ctx.fns.session.save({ agent: b });
    return { a, b };
}

test("agent.message: stored under the sender's name, envelope names whom to answer", async () => {
    const ctx = await mkTestCtx();
    const { a, b } = await pair(ctx);
    const res = await ctx.fns.agent.message({ agent: a, to: b.id, text: "what did you find?", wake: false });
    expect(res).toMatchObject({ delivered: true, to: b.id, hop: 1 });
    const msgs = await ctx.fns.session.getMessages({ id: b.id });
    const m: any = msgs.at(-1);
    expect(m.author).toBe("agent:" + a.id);
    expect(m.message_type).toBe("agent_message");
    expect(m.content).toContain(`<agent-message from="${a.id}" title="Researcher" hop="1"`);
    expect(m.content).toContain("what did you find?");
    expect(m.content).toContain(`to: "${a.id}"`);
    // Never re-prefixed as a human author.
    const out = await ctx.fns.auth.attributeMessages({ messages: msgs });
    expect(out.messages.at(-1).content).toBe(m.content);
    // UI bubble names the agent.
    const events = await ctx.fns.session.getEvents({ id: b.id });
    const ev: any = events.at(-1);
    expect(ev.actor).toBe("agent:" + a.id);
    const html = await ctx.fns.agent.renderEventHtml({ event: ev, agentId: b.id });
    expect(html).toContain('data-agent-message="' + a.id + '"');
    expect(html).toContain("Researcher");
    const author = await ctx.fns.auth.author({ userId: "agent:" + a.id });
    expect(author).toMatchObject({ kind: "agent", agentId: a.id });
});

test("agent.message: allows unrelated visible agents and rejects hidden internals", async () => {
    const ctx = await mkTestCtx();
    const { a, b } = await pair(ctx);
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET created_by = ? WHERE id = ?", params: ["different-owner", b.id] });
    await expect(ctx.fns.agent.message({ agent: a, to: b.id, text: "cross chat", wake: false })).resolves.toMatchObject({ delivered: true });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET visibility = 'hidden' WHERE id = ?", params: [b.id] });
    await expect(ctx.fns.agent.message({ agent: a, to: b.id, text: "internal", wake: false })).rejects.toThrow(/hidden\/internal/);
});

test("agent.message: reply continues the hop counter and stops at the limit", async () => {
    const ctx = await mkTestCtx();
    const { a, b } = await pair(ctx);
    let hop = 0;
    let from = a, to = b;
    // The limit itself is not asserted: it is a tuning number that has already
    // been raised once, and a test that hardcodes it fails on the change it is
    // supposed to survive rather than on a regression. What must hold is the
    // behaviour — the counter climbs by one per reply and the ping-pong is cut
    // off eventually, with a message that says why.
    let error: any = null;
    for (let i = 0; i < 200; i++) {
        const sent = await ctx.fns.agent.message({ agent: from, to: to.id, text: "ping " + i, wake: false })
            .catch((caught: any) => { error = caught; return null; });
        if (!sent) break;
        expect(sent.hop).toBe(hop + 1);
        hop = sent.hop;
        [from, to] = [to, from];
    }
    expect(hop).toBeGreaterThan(1);
    expect(String(error?.message ?? "")).toMatch(/hop limit/);
});

test("agent.message: rejects self, empty text and unknown targets", async () => {
    const ctx = await mkTestCtx();
    const { a } = await pair(ctx);
    await expect(ctx.fns.agent.message({ agent: a, to: a.id, text: "x", wake: false })).rejects.toThrow(/yourself/);
    await expect(ctx.fns.agent.message({ agent: a, to: "zz-missing", text: "x", wake: false })).rejects.toThrow(/not found/);
    await expect(ctx.fns.agent.message({ agent: a, to: "zz", text: "  ", wake: false })).rejects.toThrow(/required/);
});
