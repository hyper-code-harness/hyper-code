import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_$id_messages_POST";

test("native multipart message commits attachments", async () => {
    const calls: any[] = [], events: any[] = [];
    const agent: any = { id: "ab" };
    const ctx: any = { state: { agent: { ab: agent } }, fns: {
        attachments: { saveUploads: async () => [{ ref: { type: "image", source: { type: "url", url: "x" } }, meta: { id: "f", name: "photo.jpg" } }], commitUploads: async (opts: any) => calls.push(["commit", opts]) },
        session: { appendMessage: async () => ({ idx: 4 }), appendEvent: async (o: any) => { events.push(o.event); return { idx: 7 }; }, syncAgentState: async () => {} },
        agent: { renderEventHtml: async () => "<p>x</p>", wakeWorker: () => {} },
        auth: { actorId: async () => "u1" },
        procs: { db: { run: async () => ({ changes: 1 }) } },
    } };
    const form = new FormData(); form.set("text", "see image"); form.append("files", new File(["image"], "photo.jpg", { type: "image/jpeg" }));
    const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents/ab/messages", { method: "POST", body: form }), params: { id: "ab" } });
    expect(response.status).toBe(202);
    expect(calls[0][1]).toMatchObject({ agentId: "ab", messageIdx: 4 });
    const body: any = await response.json();
    expect(body.attachments).toHaveLength(1);
    expect(events[0].actor).toBe("u1");   // the message is recorded as the signed-in person's
});
