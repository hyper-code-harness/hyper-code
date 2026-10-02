import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("chat submission idempotency", () => {
  test("concurrent HTTP retries with one request id persist one user turn", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test", title: "idempotency" });
    const request = () => new Request(`http://localhost/agent/${agent.id}?debounceSeconds=0`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" },
      body: new URLSearchParams({ text: "send exactly once", requestId: "req-123" }),
    });
    const responses = await Promise.all([
      ctx.fns.agent.acceptMessage({ req: request(), params: { id: agent.id } }),
      ctx.fns.agent.acceptMessage({ req: request(), params: { id: agent.id } }),
    ]);
    expect(responses.map((response: Response) => response.status)).toEqual([204, 204]);
    const messages = await ctx.fns.session.getMessages({ id: agent.id });
    expect(messages.filter((message: any) => message.role === "user" && message.content === "send exactly once")).toHaveLength(1);
  });
});
