import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_$id_read_POST";

test("native read endpoint marks the chat read through the newest event", async () => {
    const marked: string[] = [];
    const ctx: any = { fns: {
        auth: { markSeen: async (opts: any) => { marked.push(opts.agentId); return 1234; } },
        procs: { db: { select: async () => [{ ts: "1234" }] } },
    } };
    const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents/ab/read", { method: "POST" }), params: { id: "ab" } });
    expect(await response.json()).toMatchObject({ ok: true, agentId: "ab", seenAt: 1234 });
    expect(marked).toEqual(["ab"]);
});
