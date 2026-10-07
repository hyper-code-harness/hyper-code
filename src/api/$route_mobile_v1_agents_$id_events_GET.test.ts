import { describe, expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_$id_events_GET";

describe("GET /api/mobile/v1/agents/:id/events", () => {
    test("filters service events, returns mobile fields, and initially requests the newest page", async () => {
        let eventOpts: any;
        const ctx: any = { state: { agent: { ab: { scratchpad: { mobileStream: { text: "live", revision: 3, startedAt: 9 } } } } }, fns: {
            auth: { author: async () => null },
            mentions: { parse: async ({ text }: any) => text.includes("@anna") ? ["anna"] : [] },
            procs: { db: { select: async ({ sql }: any) => sql.includes("SELECT 1") ? [{ exists: 1 }] : [{ run_state: "running", next_run_at: null, last_error: null }] } },
            session: {
                getEvents: async (opts: any) => { eventOpts = opts; return [{ idx: 1, ts: 10, type: "wake_up", reason: "x" }, { idx: 2, ts: 11, type: "assistant", text: "hello @anna", usage: { tokens: 1 } }]; },
                getMaxEventIdx: async () => 2,
            },
        } };
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents/ab/events?limit=10"), params: { id: "ab" } });
        expect(eventOpts).toMatchObject({ id: "ab", beforeIdx: 3, limit: 10 });
        expect(await response.json()).toMatchObject({ version: 1, agentId: "ab", nextAfter: 3, isRunning: true, partial: { text: "live", revision: 3, startedAt: 9 }, events: [{ idx: 2, type: "assistant", text: "hello @anna", mentions: ["anna"] }] });
    });

    test("includes resolved authors for multiuser messages", async () => {
        const ctx: any = { state: {}, fns: {
            auth: { author: async ({ userId }: any) => ({ id: userId, name: "Alice", initials: "A", hue: 42, picture: "https://example.com/alice.jpg" }) },
            mentions: { parse: async () => [] },
            procs: { db: { select: async ({ sql }: any) => sql.includes("SELECT 1") ? [{ exists: 1 }] : [{ run_state: "idle", next_run_at: null, last_error: null }] } },
            session: {
                getEvents: async () => [{ idx: 1, ts: 10, type: "user", text: "hello", actor: "u1" }],
                getMaxEventIdx: async () => 1,
            },
        } };
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents/ab/events"), params: { id: "ab" } });
        expect(await response.json()).toMatchObject({ events: [{ type: "user", author: { id: "u1", name: "Alice", initials: "A", hue: 42 } }] });
    });

});
