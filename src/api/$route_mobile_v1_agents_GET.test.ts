import { describe, expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_GET";

const card = (id: string, lastMessageAt = 10) => ({ id, title: `Agent ${id}`, model: "test:model", runState: "idle", hasUnread: false, turns: 0, lastMessageAt, workspaceDir: "/tmp", delegated: false, visibility: "nav" });

function mkCtx(opts: { recent: any[]; all?: any[]; pins?: string[] }) {
    const calls: any[] = [];
    const ctx: any = { fns: {
        nav: { agents: async (o: any) => {
            calls.push(o);
            if (o.ids) return (opts.all ?? []).filter((a: any) => o.ids.includes(a.id));
            return opts.recent.slice(0, o.limit);
        } },
        project: { list: async () => [] },
        mentions: { unreadByAgent: async () => ({}) },
        auth: { pinnedIds: async () => new Set<string>(opts.pins ?? []) },
        procs: { db: { select: async () => [] } },
    } };
    return { ctx, calls };
}

describe("GET /api/mobile/v1/agents", () => {
    test("returns nav agents with visibility in a stable native-client envelope", async () => {
        let listOpts: any;
        const ctx: any = { fns: { nav: { agents: async (opts: any) => {
            listOpts = opts;
            return [{ id: "ab", title: "Agent", model: "test:model", runState: "idle", hasUnread: true, turns: 0, lastMessageAt: 10, workspaceDir: "/tmp", delegated: false, visibility: "nav" }];
        } }, project: { list: async () => [{ id: "p", title: "Mobile", slug: "mobile", defaultDir: "/tmp", defaultHost: "", createdBy: null, createdAt: 1, updatedAt: 1, archivedAt: null, agents: 1 }] }, mentions: { unreadByAgent: async () => ({ ab: 1 }) }, auth: { pinnedIds: async () => new Set<string>() }, procs: { db: { select: async () => [{ id: "ab", projectId: "p" }] } } } };
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents"), params: {} });
        expect(response.status).toBe(200);
        expect(listOpts).toEqual({ limit: 51 });
        expect(await response.json()).toEqual({ version: 1, offset: 0, limit: 50, hasMore: false, agents: [{ id: "ab", title: "Agent", model: "test:model", runState: "idle", unread: 1, mentions: 1, turns: 0, updatedAt: 10, workspaceDir: "/tmp", projectId: "p", projectTitle: "Mobile", pinned: false, delegated: false, visibility: "nav" }] });
    });

    test("always includes pinned sessions that fall outside the recent window, de-duplicated", async () => {
        const recent = [card("r1", 30), card("r2", 20), card("pn", 15)];
        const { ctx, calls } = mkCtx({ recent, all: [...recent, card("old", 1)], pins: ["old", "pn"] });
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents?limit=3"), params: {} });
        const body: any = await response.json();
        expect(body.agents.map((a: any) => a.id)).toEqual(["r1", "r2", "pn", "old"]);
        expect(body.agents.filter((a: any) => a.pinned).map((a: any) => a.id)).toEqual(["pn", "old"]);
        expect(calls[1]).toEqual({ ids: ["old"], limit: 500 });
    });

    test("passes q, offset, projectId and bounded limit through and reports hasMore", async () => {
        const { ctx, calls } = mkCtx({ recent: [card("a"), card("b"), card("c")], pins: ["zz"] });
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents?q=%20hyper%20pg&limit=2&offset=4&projectId=p1"), params: {} });
        const body: any = await response.json();
        expect(calls).toEqual([{ q: "hyper pg", limit: 3, offset: 4, projectId: "p1" }]);
        expect(body).toMatchObject({ offset: 4, limit: 2, hasMore: true });
        expect(body.agents.map((a: any) => a.id)).toEqual(["a", "b"]);
    });

    test("pinned lookup honours the search filter and limit is capped at 500", async () => {
        const { ctx, calls } = mkCtx({ recent: [], all: [], pins: ["old"] });
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents?q=pg&limit=9999"), params: {} });
        expect(((await response.json()) as any).limit).toBe(500);
        expect(calls).toEqual([{ q: "pg", limit: 501 }, { ids: ["old"], limit: 500, q: "pg" }]);
    });
});
