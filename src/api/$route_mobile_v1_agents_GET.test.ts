import { describe, expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_GET";

describe("GET /api/mobile/v1/agents", () => {
    test("returns nav agents with visibility in a stable native-client envelope", async () => {
        let listOpts: any;
        const ctx: any = { fns: { session: { list: async (opts: any) => {
            listOpts = opts;
            return [{ id: "ab", title: "Agent", model: "test:model", runState: "idle", unread: 2, turns: 3, updatedAt: 10, workspaceDir: "/tmp", delegated: false, visibility: "nav" }];
        } }, auth: { pinnedIds: async () => new Set<string>() }, procs: { db: { select: async () => [] } } } };
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents"), params: {} });
        expect(response.status).toBe(200);
        expect(listOpts).toEqual({});
        expect(await response.json()).toEqual({ version: 1, agents: [{ id: "ab", title: "Agent", model: "test:model", runState: "idle", unread: 2, turns: 3, updatedAt: 10, workspaceDir: "/tmp", pinned: false, delegated: false, visibility: "nav" }] });
    });
});
