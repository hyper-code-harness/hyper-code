import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("POST /agent/:id/compact", () => {
  test("queues compaction without interrupting a running agent and retains the context-ring entry point", async () => {
    const ctx = await mkTestCtx();
    const abortController = new AbortController();
    const agent: any = { id: "a1", model: "test:model", messages: [], events: [], scratchpad: {}, workspaceDir: process.cwd(), systemPrompt: "", runState: "running", abortController };
    ctx.state.agent = { a1: agent };
    const requests: any[] = [], notifications: any[] = [];
    ctx.state.registry.agent.requestCompaction = async (_c: any, _s: any, o: any) => {
      requests.push(o);
      return { status: "queued", jobId: "compact-job-1", reused: false };
    };
    ctx.state.registry.agent.compactContext = () => { throw new Error("Must not compact inline"); };
    ctx.state.registry.ui.notify = async (_c: any, _s: any, o: any) => { notifications.push(o); };
    const body = new FormData(); body.set("instructions", "  focus tests  ");
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/a1/compact", body });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-compaction-status")).toBe("queued");
    expect(res.headers.get("x-compaction-job")).toBe("compact-job-1");
    expect(res.headers.get("hx-refresh")).toBe("true");
    expect(await res.text()).toBe("");
    expect(requests).toEqual([{ agentId: "a1", instructions: "focus tests" }]);
    expect(notifications).toEqual([{ message: "Compaction queued; it will run after the current turn.", level: "info" }]);
    expect(abortController.signal.aborted).toBe(false);
    ctx.state.registry.session.getMaxEventIdx = () => -1;
    ctx.state.registry.session.getEvents = () => [];
    ctx.state.registry.session.getFullMessages = () => [];
    const html = await ctx.fns.ui.chatColumn({ agentId: "a1" });
    expect(html).toContain('id="chat-context-ring"');
    expect(html).toContain("/chat/a1/ring");
  });

  test("missing, blank and file focus fields use default instructions without coercing uploads", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = { a1: { id: "a1" } };
    const requests: any[] = [];
    ctx.state.registry.agent.requestCompaction = async (_c: any, _s: any, o: any) => {
      requests.push(o);
      return { status: "queued", jobId: "compact-default", reused: false };
    };
    ctx.state.registry.ui.notify = async () => {};
    for (const focus of [undefined, "", " \n\t ", new File(["not focus text"], "focus.txt")]) {
      const body = new FormData();
      if (focus !== undefined) body.set("instructions", focus);
      const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/a1/compact", body });
      expect(res.status).toBe(202);
      expect(requests.at(-1)).toEqual({ agentId: "a1", instructions: undefined });
    }
    expect(requests).toHaveLength(4);
  });

  test("loads an idle agent and accepts a reused queued job even when notification fails", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = {};
    ctx.state.registry.session.load = async (_c: any, _s: any, o: any) => o.id === "a1" ? { id: "a1" } : null;
    ctx.state.registry.agent.requestCompaction = async () => ({ status: "queued", jobId: "existing-job", reused: true });
    ctx.state.registry.ui.notify = async () => { throw new Error("notification unavailable"); };
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/a1/compact", body: new FormData() });
    expect(res.status).toBe(202);
    expect(res.headers.get("x-compaction-status")).toBe("queued");
    expect(res.headers.get("x-compaction-job")).toBe("existing-job");
  });

  test("returns 404 for an unknown agent without queuing", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = {};
    ctx.state.registry.session.load = async () => null;
    let requested = false;
    ctx.state.registry.agent.requestCompaction = async () => { requested = true; };
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/missing/compact", body: new FormData() });
    expect(res.status).toBe(404);
    expect(requested).toBe(false);
  });

  test("does not report queued when the queue request fails", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = { a1: { id: "a1" } };
    ctx.state.registry.agent.requestCompaction = async () => { throw new Error("queue unavailable"); };
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/a1/compact", body: new FormData() });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("queue unavailable");
    expect(res.headers.has("x-compaction-job")).toBe(false);
  });
});
