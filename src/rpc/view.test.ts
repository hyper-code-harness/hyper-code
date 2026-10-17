import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

// Canvas as URL, iteration 1: `@view` functions open at GET /rpc/<fn>?<json>, a `view` canvas tab shows that
// address, keeps its own back/forward history, and memory.view / memory.table are the first views.
let ctx: any, r: any, agentId: string;
const get = (path: string) => ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost" + path });

beforeAll(async () => {
    ctx = await mkTestCtx({ env: { HYPER_HOME: await mkdtemp(join(tmpdir(), "view-home-")) } });
    r = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    agentId = a.id;
    // An open test instance reads pages as its owner.
    await ctx.fns.procs.db.run({ sql: `insert into users (id, email, name, role, created_at, updated_at) values ('boss', 'boss@x', 'boss', 'owner', 0, 0) on conflict do nothing`, params: [] });
    const as = Object.create(ctx); as.session = { kind: "agent", agentId };
    await as.fns.memory.write({ path: "notes/a.md", content: "# Note A\n\nSee [[b]] and <script>alert(1)</script>.", title: "A", description: "a", kind: "decision" });
    await as.fns.memory.write({ path: "notes/b.md", content: "Note B", title: "B", description: "b" });
    await as.fns.memory.put({ key: "todo/x", data: { status: "open" }, title: "do x", kind: "todo" });
});

describe("canvas = url", () => {
    test("rpc.url is canonical: sorted keys, empty params give a bare address", () => {
        expect(ctx.fns.rpc.url({ fn: "memory.view", params: { key: "k", a: { z: 1, b: 2 } } })).toBe("/rpc/memory.view?" + encodeURIComponent('{"a":{"b":2,"z":1},"key":"k"}'));
        expect(ctx.fns.rpc.url({ fn: "memory.table" })).toBe("/rpc/memory.table");
        expect(() => ctx.fns.rpc.url({ fn: "nope" })).toThrow();
    });

    test("the @view tag reaches the metadata", () => {
        expect(ctx.fns.runtime.docs.get({ name: "memory.view" }).view).toBe(true);
        expect(ctx.fns.runtime.docs.get({ name: "memory.list" }).view).toBeUndefined();
    });

    test("GET /rpc/<fn> serves only @view functions, as a sandboxed page", async () => {
        const ok = await get("/rpc/memory.table");
        expect(ok.status).toBe(200);
        expect(ok.headers.get("content-security-policy")).toContain("sandbox");
        expect(await get("/rpc/memory.list").then((x: Response) => x.status)).toBe(405);
        expect(await get("/rpc/nope.x").then((x: Response) => x.status)).toBe(404);
        expect(await get("/rpc/memory.view?" + encodeURIComponent("{oops")).then((x: Response) => x.status)).toBe(400);
        expect(await get("/rpc/__proto__.x").then((x: Response) => x.status)).toBe(400);
    });

    test("a view tab opens the address, moves on links, and steps back and forward", async () => {
        const show = await r.fns.canvas.show({ agentId, kind: "view", args: { url: "/rpc/memory.view?key=notes/a.md" } });
        expect(show.args).toMatchObject({ fn: "memory.view", params: { key: "notes/a.md" }, url: ctx.fns.rpc.url({ fn: "memory.view", params: { key: "notes/a.md" } }) });
        const again = await r.fns.canvas.show({ agentId, kind: "view", args: { fn: "memory.view", params: { key: "notes/a.md" } } });
        expect(again.id).toBe(show.id);
        await expect(r.fns.canvas.show({ agentId, kind: "view", args: { fn: "memory.list" } })).rejects.toThrow(/@view/);
        const b = ctx.fns.rpc.url({ fn: "memory.view", params: { key: "notes/b.md" } });
        const moved = await r.fns.canvas.navigate({ agentId, itemId: show.id, url: b });
        expect(moved.args.url).toBe(b);
        expect(moved.state.back).toEqual([show.args.url]);
        const back = await r.fns.canvas.navigate({ agentId, itemId: show.id, history: "back" });
        expect(back.args.url).toBe(show.args.url);
        expect(back.state.forward).toEqual([b]);
        const fwd = await r.fns.canvas.navigate({ agentId, itemId: show.id, history: "forward" });
        expect(fwd.args.url).toBe(b);
        const html = await ctx.fns.canvas.panelHtml({ agentId });
        expect(html).toContain("data-canvas-view");
        expect(html).toContain('data-canvas-step="back"');
    });

    test("memory.view renders a note with [[links]] as view links, records as data; memory.table lists them", async () => {
        const as = Object.create(ctx); as.session = { kind: "agent", agentId };
        const note: string = await as.fns.memory.view({ key: "notes/a.md" });
        expect(note).toContain("Note A");
        expect(note).toContain(ctx.fns.rpc.url({ fn: "memory.view", params: { key: "notes/b.md" } }).replace(/&/g, "&amp;"));
        expect(await as.fns.memory.view({ key: "todo/x" })).toContain("&quot;status&quot;: &quot;open&quot;");
        const table: string = await as.fns.memory.table({ prefix: "notes/" });
        expect(table).toContain("notes/a.md");
        expect(table).not.toContain("todo/x");
        await expect(as.fns.memory.view({ key: "notes/none.md" })).rejects.toThrow();
    });

    test("a saved html page keeps its own document and gets the link bridge", async () => {
        const as = Object.create(ctx); as.session = { kind: "agent", agentId };
        await as.fns.memory.write({ path: "pages/p.html", content: "<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>P</h1></body></html>", title: "P", description: "p", kind: "page" });
        const page: string = await as.fns.memory.view({ key: "pages/p.html" });
        expect(page).toStartWith("<!doctype html>");
        const res: Response = ctx.fns.rpc.page({ title: "P", value: page });
        const body = await res.text();
        expect(body).toContain("h1{color:red}");
        expect(body).toContain("hyperCanvas");
        expect(body).not.toContain("rpc-muted");
    });

    test("a person sees their agents' memory, another person does not", async () => {
        const now = Date.now();
        for (const id of ["ann", "ben"]) await ctx.fns.procs.db.run({ sql: `insert into users (id, email, name, role, created_at, updated_at) values (?, ?, ?, 'member', ?, ?) on conflict do nothing`, params: [id, `${id}@x`, id, now, now] });
        await ctx.fns.procs.db.run({ sql: "update agents set created_by = 'ann' where id = ?", params: [agentId] });
        const person = (id: string) => { const c = Object.create(ctx); c.session = { kind: "http", user: { id, role: "member" } }; return c; };
        expect(await person("ann").fns.memory.view({ key: "notes/a.md" })).toContain("Note A");
        await expect(person("ben").fns.memory.view({ key: "notes/a.md" })).rejects.toThrow(/visible/);
    });
});
