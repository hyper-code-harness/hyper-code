import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";

// Memory on four levels under a temporary HYPER_HOME: system, user (the agent's person), project, agent.
let ctx: any, home: string, slug: string, agentId: string, otherId: string, strangerId: string, loneId: string;
const as = (id: string) => { const c = Object.create(ctx); c.session = { kind: "agent", agentId: id }; return c; };

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "mem-home-"));
    ctx = await mkTestCtx({ env: { HYPER_HOME: home } });
    const now = Date.now();
    slug = "t" + Math.random().toString(36).slice(2, 8);
    await ctx.fns.procs.db.run({ sql: `insert into projects (id, slug, title, default_dir, created_at, updated_at) values (?, ?, 'test', '/tmp', ?, ?)`, params: [slug, slug, now, now] });
    for (const [id, role] of [["alice", "member"], ["bob", "member"], ["root", "owner"]]) {
        await ctx.fns.procs.db.run({ sql: `insert into users (id, email, name, role, created_at, updated_at) values (?, ?, ?, ?, ?, ?) on conflict do nothing`, params: [id, `${id}@x`, id, role, now, now] });
    }
    agentId = (await ctx.fns.agent.start({ model: "mock:test", title: "mem" })).id;
    otherId = (await ctx.fns.agent.start({ model: "mock:test", title: "other" })).id;
    strangerId = (await ctx.fns.agent.start({ model: "mock:test", title: "stranger" })).id;
    loneId = (await ctx.fns.agent.start({ model: "mock:test", title: "lone" })).id;
    await ctx.fns.procs.db.run({ sql: `update agents set project_id = ?, created_by = 'alice' where id in (?, ?)`, params: [slug, agentId, otherId] });
    await ctx.fns.procs.db.run({ sql: `update agents set created_by = 'bob' where id = ?`, params: [strangerId] });
    await ctx.fns.procs.db.run({ sql: `update agents set created_by = 'alice' where id = ?`, params: [loneId] });
});

describe("memory", () => {
    test("scope puts every level under HYPER_HOME/memory", async () => {
        const s = await as(agentId).fns.memory.scope({});
        expect(s.systemDir).toBe(join(home, "memory"));
        expect(s.userDir).toBe(join(home, "memory/users/alice"));
        expect(s.projectDir).toBe(join(home, "memory/projects", slug));
        expect(s.agentDir).toBe(join(home, "memory/agents", agentId));
    });

    test("write stores the file, indexes it with an absolute file:// url, and read returns it", async () => {
        const m = as(agentId).fns.memory;
        const w = await m.write({ path: "notes/a.md", content: "hello", title: "A", description: "note a", visibility: "project", kind: "decision" });
        expect(w.url).toBe("file://" + join(home, "memory/projects", slug, "notes/a.md"));
        expect(await Bun.file(w.path).text()).toBe("hello");
        expect(await m.read({ key: "notes/a.md" })).toMatchObject({ type: "file", kind: "decision", content: "hello", stale: false, version: 1, visibility: "project" });
        expect((await m.write({ path: "notes/a.md", content: "hello 2", title: "A", description: "note a", visibility: "project" })).version).toBe(2);
    });

    test("levels: agent is private, project is shared in the project, user follows the person across projects", async () => {
        const w = await as(agentId).fns.memory.write({ path: "notes/mine.md", content: "m", title: "m", description: "m" });
        expect(w.visibility).toBe("agent");
        expect(await as(otherId).fns.memory.read({ id: w.id })).toBeNull();
        expect((await as(otherId).fns.memory.read({ key: "notes/a.md" }))?.content).toBe("hello 2");
        expect(await as(strangerId).fns.memory.read({ key: "notes/a.md" })).toBeNull();
        const u = await as(agentId).fns.memory.put({ key: "pref/lang", data: "ru", title: "language", visibility: "user", kind: "preference" });
        expect((await as(loneId).fns.memory.read({ key: "pref/lang" }))?.data).toBe("ru");      // same person, no project
        expect(await as(strangerId).fns.memory.read({ id: u.id })).toBeNull();                 // another person
    });

    test("the nearest level wins for the same key", async () => {
        await as(agentId).fns.memory.put({ key: "x", data: "user", title: "x", visibility: "user" });
        await as(agentId).fns.memory.put({ key: "x", data: "project", title: "x", visibility: "project" });
        expect((await as(agentId).fns.memory.read({ key: "x" })).data).toBe("project");
        await as(agentId).fns.memory.put({ key: "x", data: "agent", title: "x" });
        expect((await as(agentId).fns.memory.read({ key: "x" })).data).toBe("agent");
        expect((await as(loneId).fns.memory.read({ key: "x" })).data).toBe("user");
    });

    test("system memory: everyone reads it, only the instance owner's agents write it", async () => {
        await expect(as(agentId).fns.memory.write({ path: "notes/s.md", content: "s", title: "s", description: "s", visibility: "system" })).rejects.toThrow(/owner/);
        await ctx.fns.procs.db.run({ sql: `update agents set created_by = 'root' where id = ?`, params: [strangerId] });
        await as(strangerId).fns.memory.write({ path: "notes/s.md", content: "s", title: "s", description: "s", visibility: "system" });
        await ctx.fns.procs.db.run({ sql: `update agents set created_by = 'bob' where id = ?`, params: [strangerId] });
        expect((await as(agentId).fns.memory.file({ ref: "notes/s.md" })).text).toBe("s");
        await expect(as(agentId).fns.memory.edit({ key: "notes/s.md", oldText: "s", newText: "t" })).rejects.toThrow(/owner/);
        await expect(as(strangerId).fns.memory.write({ path: "users/alice/x.md", content: "x", title: "x", description: "x", visibility: "system" })).rejects.toThrow();
    });

    test("an edit outside memory.write is reported as stale", async () => {
        const w = await as(agentId).fns.memory.write({ path: "notes/b.md", content: "b", title: "B", description: "b" });
        await appendFile(w.path, " changed");
        expect((await as(agentId).fns.memory.read({ id: w.id })).stale).toBe(true);
        expect((await as(agentId).fns.memory.file({ ref: w.url })).stale).toBe(true);
    });

    test("file reads by key, path and url, and refuses other people's, agents' and outside files", async () => {
        const m = as(agentId).fns.memory;
        const abs = join(home, "memory/projects", slug, "notes/a.md");
        for (const ref of ["notes/a.md", abs, "file://" + abs]) expect((await m.file({ ref })).text).toBe("hello 2");
        await Bun.write(join(home, "memory/users/bob/secret.md"), "x");
        await Bun.write(join(home, "secret.env"), "x");
        for (const ref of [join(home, "memory/users/bob/secret.md"), join(home, "secret.env"), "file:///etc/passwd"]) await expect(m.file({ ref })).rejects.toThrow();
        await expect(as(otherId).fns.memory.file({ ref: join(home, "memory/agents", agentId, "notes/mine.md") })).rejects.toThrow();
    });

    test("write refuses paths that escape the level folder", async () => {
        const m = as(agentId).fns.memory;
        await expect(m.write({ path: "../../escape.md", content: "x", title: "x", description: "x" })).rejects.toThrow();
        await expect(m.write({ path: "/tmp/escape.md", content: "x", title: "x", description: "x" })).rejects.toThrow();
    });

    test("put stores jsonb records and list filters by level, type, kind and prefix", async () => {
        const m = as(agentId).fns.memory;
        await m.put({ key: "bugs/one", data: { status: "open" }, title: "bug one", kind: "bug" });
        expect((await m.put({ key: "bugs/one", data: { status: "fixed" }, title: "bug one", kind: "bug" })).version).toBe(2);
        expect((await m.read({ key: "bugs/one" })).data).toEqual({ status: "fixed" });
        expect((await m.list({ kind: "bug" })).map((e: any) => e.key)).toEqual(["bugs/one"]);
        expect((await m.list({ visibility: "user" })).map((e: any) => e.key).sort()).toEqual(["pref/lang", "x"]);
        expect((await m.list({ type: "jsonb" })).every((e: any) => e.type === "jsonb")).toBe(true);
    });

    test("project level needs a project", async () => {
        await expect(as(loneId).fns.memory.put({ key: "k", data: 1, title: "k", visibility: "project" })).rejects.toThrow(/no project/);
    });
});
