import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("POST /api/mobile/v1/agents/:id/compact", () => {
  test("queues compaction for a running agent in the native-client envelope", async () => {
    const ctx = await mkTestCtx();
    const abortController = new AbortController();
    ctx.state.agent = { a1: { id: "a1", runState: "running", abortController } };
    const requests: any[] = [];
    ctx.state.registry.agent.requestCompaction = async (_c: any, _s: any, o: any) => {
      requests.push(o);
      return { status: "queued", jobId: "mobile-job", reused: false };
    };
    ctx.state.registry.agent.compactContext = () => { throw new Error("Must not compact inline"); };
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/api/mobile/v1/agents/a1/compact", body: { instructions: "  focus tests  " } });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ version: 1, ok: true, status: "queued", jobId: "mobile-job" });
    expect(requests).toEqual([{ agentId: "a1", instructions: "focus tests" }]);
    expect(abortController.signal.aborted).toBe(false);
  });

  test("defaults optional focus for empty, malformed and non-string JSON values", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = { a1: { id: "a1" } };
    const requests: any[] = [];
    ctx.state.registry.agent.requestCompaction = async (_c: any, _s: any, o: any) => {
      requests.push(o);
      return { status: "queued", jobId: "default-job", reused: false };
    };
    const bodies = [undefined, "{bad json", "null", {}, { instructions: " \n\t " }, { instructions: 12 }, { instructions: { focus: "not a string" } }];
    for (const body of bodies) {
      const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/api/mobile/v1/agents/a1/compact", body });
      expect(res.status).toBe(202);
      expect(requests.at(-1)).toEqual({ agentId: "a1", instructions: undefined });
    }
    expect(requests).toHaveLength(bodies.length);
  });

  test("loads an idle agent and returns the same envelope for a reused job", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = {};
    ctx.state.registry.session.load = async (_c: any, _s: any, o: any) => o.id === "a1" ? { id: "a1" } : null;
    ctx.state.registry.agent.requestCompaction = async () => ({ status: "queued", jobId: "existing-job", reused: true });
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/api/mobile/v1/agents/a1/compact" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ version: 1, ok: true, status: "queued", jobId: "existing-job" });
  });

  test("returns not_found without queuing for an unknown agent", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = {};
    ctx.state.registry.session.load = async () => null;
    let requested = false;
    ctx.state.registry.agent.requestCompaction = async () => { requested = true; };
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/api/mobile/v1/agents/missing/compact" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Agent not found" });
    expect(requested).toBe(false);
  });

  test("preserves the native error envelope when the queue request fails", async () => {
    const ctx = await mkTestCtx();
    ctx.state.agent = { a1: { id: "a1" } };
    ctx.state.registry.agent.requestCompaction = async () => { throw new Error("queue unavailable"); };
    const res = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/api/mobile/v1/agents/a1/compact" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "compact_failed", message: "queue unavailable" });
  });
});
