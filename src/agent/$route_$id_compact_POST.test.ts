import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("POST /agent/:id/compact", () => {
  test("dispatches manual compaction and offers the compact form from the context ring", async () => {
    const ctx = await mkTestCtx();
    const agent: any = { id: "a1", model: "test:model", messages: [], events: [], scratchpad: {}, workspaceDir: process.cwd(), systemPrompt: "" };
    (ctx.state as any).agent = { a1: agent };
    ctx.state.registry.agent.compactContext = (_c: any, _s: any, o: any) => ({ status: "compacted", tokensBefore: 10, instructions: o.instructions });
    const body = new FormData(); body.set("instructions", "focus tests");
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/a1/compact", body });
    expect(res.status).toBe(204);
    expect(res.headers.get("x-compaction-status")).toBe("compacted");
    ctx.state.registry.session.getMaxEventIdx = () => -1;
    ctx.state.registry.session.getEvents = () => [];
    ctx.state.registry.session.getFullMessages = () => [];
    // The chat shows a context ring in the composer; it opens the compact form (chat.compactPopup).
    const html = await ctx.fns.ui.chatColumn({ agentId: "a1" });
    expect(html).toContain('id="chat-context-ring"');
    expect(html).toContain("/chat/a1/ring");
    const form = ctx.fns.chat.compactForm({ agentId: "a1" });
    expect(form).toContain("Compact context");
    expect(form).toContain('hx-post="/agent/a1/compact"');
  });
});
