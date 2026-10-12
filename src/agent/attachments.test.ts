import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent attachments", () => {
    test("deduplicates producer events and wakes each matching agent once", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        ctx.state.attachments = {
            declarations: { demo: { events: ["message.new"], start: async () => ({ stop() {} }) } },
            running: {},
        };
        const attachment = await ctx.fns.agent.attach({
            id: agent.id,
            source: "demo",
            events: ["message.new"],
            filter: { chatId: ["42"] },
            prompt: "New chat message",
        });
        const first = await ctx.fns.agent.emitAttachment({
            source: "demo",
            eventId: "42:7",
            eventType: "message.new",
            payload: { chatId: "42", messageId: 7, text: "hello" },
        });
        expect(first).toEqual({ duplicate: false, deliveries: 1 });
        for (let i = 0; i < 50; i++) {
            const rows = await ctx.fns.procs.db.select({ sql: "SELECT status FROM attachment_deliveries WHERE attachment_id=?", params: [attachment.id] });
            if (rows[0]?.status === "delivered") break;
            await Bun.sleep(5);
        }
        const duplicate = await ctx.fns.agent.emitAttachment({
            source: "demo",
            eventId: "42:7",
            eventType: "message.new",
            payload: { chatId: "42", messageId: 7, text: "hello" },
        });
        expect(duplicate).toEqual({ duplicate: true, deliveries: 0 });
        const messages = await ctx.fns.session.getMessages({ id: agent.id, includeExcluded: true });
        expect(messages.filter((m: any) => String(m.content).includes("hello"))).toHaveLength(1);
        expect(messages.at(-1).message_type).toBe("trigger");
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.some((e: any) => e.type === "attachment_event" && e.source === "demo")).toBe(true);
        expect(events.some((e: any) => e.type === "wake_up" && e.attachmentDeliveryId)).toBe(false);

    });

    test("detach stops the last producer and prevents later delivery", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        let stopped = 0;
        ctx.state.attachments = {
            declarations: { demo: { events: ["message.new"], start: async () => ({ stop() { stopped++; } }) } },
            running: {},
        };
        const attachment = await ctx.fns.agent.attach({ id: agent.id, source: "demo" });
        expect(await ctx.fns.agent.detach({ id: agent.id, attachmentId: attachment.id })).toEqual({ detached: true });
        expect(stopped).toBe(1);
        expect((await ctx.fns.agent.attachments({ id: agent.id, status: "all" }))[0].status).toBe("detached");
        expect((await ctx.fns.agent.emitAttachment({ source: "demo", eventId: "x", eventType: "message.new", payload: {} })).deliveries).toBe(0);
    });
});
