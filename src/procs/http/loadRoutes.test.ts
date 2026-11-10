// loadRoutes rescans the disk in every mode: a server run from source with NODE_ENV=production must still
// pick up a $script_ that arrived after boot (a git pull), and a baked bundle keeps its own entries.
import { test, expect } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();

async function withState<T>(env: string | undefined, boot: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const state = ctx.state as any;
    const saved = { env: ctx.env.NODE_ENV, entries: state.procs.boot.entries, baked: state.procs.boot.baked, routes: state.procs.http.routes };
    ctx.env.NODE_ENV = env;
    Object.assign(state.procs.boot, boot);
    try { return await fn(); }
    finally {
        ctx.env.NODE_ENV = saved.env;
        state.procs.boot.entries = saved.entries;
        state.procs.boot.baked = saved.baked;
        state.procs.http.routes = saved.routes;
    }
}

test("production from source: a script missing from the boot list still gets its route", async () => {
    const routes = await withState("production", { entries: [], baked: undefined }, () => ctx.fns.procs.http.loadRoutes({}));
    expect(typeof routes["/keys/keys.js"]?.GET).toBe("function");
    expect(typeof routes["/ui/hotkeys.js"]?.GET).toBe("function");
});

test("a baked bundle keeps its baked routes and adds what the scan finds", async () => {
    const baked = [{ kind: "route", rel: "baked/$route_baked_GET.ts", abs: "/nowhere/baked/$route_baked_GET.ts", routePath: "/baked", method: "GET", fn: async () => new Response("baked") }];
    const routes = await withState("production", { baked }, () => ctx.fns.procs.http.loadRoutes({}));
    expect(typeof routes["/baked"]?.GET).toBe("function");
    expect(typeof routes["/keys/keys.js"]?.GET).toBe("function");
});
