import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function makeAgent(ctx: any, id = "pn") {
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: "INSERT INTO agents(id, model, title, workspace_dir, created_at, updated_at) VALUES (?, 'mock:echo', 'Pinned test', '/tmp', ?, ?)",
        params: [id, now, now],
    });
}

describe("web nav pin route", () => {
    test("pins and unpins an agent and asks HTMX to refresh the menu", async () => {
        const ctx = await mkTestCtx();
        await makeAgent(ctx);

        const pin = await ctx.fns.procs.http.dispatch({
            method: "POST", url: "/nav/agent/pn/pin", body: new URLSearchParams({ pinned: "1" }),
        });
        expect(pin.status).toBe(204);
        expect(pin.headers.get("HX-Trigger")).toBe("nav-refresh");
        let rows = await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = 'mobile-pin-agent:pn'" });
        expect(rows).toHaveLength(1);

        const menu = await ctx.fns.procs.http.dispatch({ url: "/nav/items" });
        const html = await menu.text();
        expect(html).toContain("Unpin agent");
        expect(html).toContain("ph-push-pin-slash");
        expect(html).toContain("group-hover:opacity-60");
        expect(html).not.toContain("ph-push-pin-slash text-error");
        expect(html.indexOf('>Shared Agents</h3>')).toBeLessThan(html.indexOf('>Pinned</h4>'));
        expect(html.match(/Pinned test/g)?.length).toBeGreaterThanOrEqual(2); // recent + pinned shortcut

        const unpin = await ctx.fns.procs.http.dispatch({
            method: "POST", url: "/nav/agent/pn/pin", body: new URLSearchParams({ pinned: "0" }),
        });
        expect(unpin.status).toBe(204);
        rows = await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = 'mobile-pin-agent:pn'" });
        expect(rows).toHaveLength(0);
    });

    test("returns 404 for an unknown agent", async () => {
        const ctx = await mkTestCtx();
        const response = await ctx.fns.procs.http.dispatch({
            method: "POST", url: "/nav/agent/missing/pin", body: new URLSearchParams({ pinned: "1" }),
        });
        expect(response.status).toBe(404);
    });
});
