import { expect, test } from "bun:test";
import items from "./items";

test("global navigation keeps plugin applications and one catalogue link, not mounted plugin records", async () => {
    const ctx: any = {
        state: {
            nav: { apps: {
                plugins: { label: "Plugins", href: "/plugins", group: "System", order: 55 },
                hyperhub: { label: "HyperHub", href: "/plugins?provider=hyperhub", group: "Tools", order: 60 },
                news: { label: "News", href: "/news", group: "Pages", order: 10 },
            } },
            procs: { http: { routes: { "/plugins": { GET: () => {} }, "/news": { GET: () => {} }, "/plugins/config": { GET: () => {} }, "/plugins/search": { GET: () => {} } } } },
        },
        fns: { plugins: { list: () => { throw new Error("Mounted plugins must not be enumerated for navigation"); } } },
    };
    const result = await items(ctx, null, { includeAgents: false, limit: 100 });
    expect(result.map(item => item.href)).toEqual(["/news", "/plugins"]);
    const searched = await items(ctx, null, { includeAgents: false, q: "Plugins" });
    expect(searched.map(item => item.href)).toEqual(["/plugins"]);
});

test("HTTP routes never become menu entries without an app declaration", async () => {
    const ctx: any = { state: { nav: { apps: {
        tasks: { label: "Tasks", href: "/tasks", group: "Pages", order: 10 },
        modules: { label: "Modules", href: "/procs/modules", group: "System", order: 20 },
    } }, procs: { http: { routes: Object.fromEntries(["/tasks", "/dev/fail", "/ui/ping", "/mentions/badge", "/unknown-page", "/node/v1/models"].map(path => [path, { GET: () => {} }])) } } }, fns: {} };
    expect((await items(ctx, null, { includeAgents: false, limit: 100 })).map(item => item.href)).toEqual(["/tasks"]);
    expect(await items(ctx, null, { includeAgents: false, q: "ping" })).toEqual([]);
});
