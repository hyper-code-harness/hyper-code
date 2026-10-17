import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";

// Functions as memory under a temporary home: folder grammar, access, the code index and the prompt block.
let ctx: any, home: string, slug: string, agentId: string, strangerId: string;
const as = (session: Record<string, unknown>) => { const c = Object.create(ctx); c.session = session; return c; };
const fn = (title: string) => `/**\n * ${title}\n * @param opts.x Anything.\n */\nexport default async function (ctx: Context, session: Session | null, opts: {\n    /** Anything. */\n    x?: number;\n}): Promise<{ ok: boolean }> {\n    return { ok: true };\n}\n`;

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "fns-home-"));
    ctx = await mkTestCtx({ env: { HYPER_HOME: home } });
    const now = Date.now();
    slug = "t" + Math.random().toString(36).slice(2, 8);
    await ctx.fns.procs.db.run({ sql: `insert into projects (id, slug, title, default_dir, created_at, updated_at) values (?, ?, 'test', '/tmp', ?, ?)`, params: [slug, slug, now, now] });
    for (const id of ["alice", "m.bob"]) await ctx.fns.procs.db.run({ sql: `insert into users (id, email, name, role, created_at, updated_at) values (?, ?, ?, 'member', ?, ?) on conflict do nothing`, params: [id, `${id}@x`, id, now, now] });
    agentId = (await ctx.fns.agent.start({ model: "mock:test", title: "fns" })).id;
    strangerId = (await ctx.fns.agent.start({ model: "mock:test", title: "stranger" })).id;
    await ctx.fns.procs.db.run({ sql: `update agents set project_id = ?, created_by = 'alice' where id = ?`, params: [slug, agentId] });
    await ctx.fns.procs.db.run({ sql: `update agents set created_by = 'm.bob' where id = ?`, params: [strangerId] });
    for (const d of [`project_${slug}`, `agent_${agentId}`, "user_alice", "notAllowed"]) await mkdir(join(home, "src", d), { recursive: true });
    await writeFile(join(home, `src/project_${slug}/tables.ts`), fn("Lists the project's tables."));
    await writeFile(join(home, `src/project_${slug}/tables.test.ts`), `import { test } from "bun:test"; test("x", () => {});\n`);
    await writeFile(join(home, `src/agent_${agentId}/draw.ts`), fn("Draws a private sketch."));
    await writeFile(join(home, "src/user_alice/style.ts"), fn("Applies alice's writing style."));
    await writeFile(join(home, "src/notAllowed/x.ts"), fn("Must never load."));
    ((ctx.state.procs.project ??= {}).fnRoots ??= {}).test = home;
});

describe("functions as memory", () => {
    test("discover mounts HYPER_HOME/src and scan keeps only user_/project_/agent_ folders", async () => {
        const entries: any[] = await ctx.fns.procs.project.scan({});
        const mine = entries.filter(e => e.abs.startsWith(join(home, "src")) && e.kind === "fn");
        expect(mine.map(e => `${e.module}.${e.runtimeName}`).sort()).toEqual([`agent_${agentId}.draw`, `project_${slug}.tables`, "user_alice.style"]);
    });

    test("canCall: user functions for the person and their agents, project for its agents and people, agent for itself and its person", async () => {
        const c = ctx.fns.project.canCall;
        expect((await c({ name: "user_alice.style", agentId })).allowed).toBe(true);
        expect((await c({ name: "user_alice.style", userId: "alice" })).allowed).toBe(true);
        expect((await c({ name: "user_alice.style", agentId: strangerId })).allowed).toBe(false);
        expect((await c({ name: "user_nobody.style", agentId })).allowed).toBe(false);
        expect((await c({ name: `project_${slug}.tables`, agentId })).allowed).toBe(true);
        expect((await c({ name: `project_${slug}.tables`, agentId: strangerId })).allowed).toBe(false);
        expect((await c({ name: `agent_${agentId}.draw`, userId: "alice" })).allowed).toBe(true);
        expect((await c({ name: `agent_${agentId}.draw`, userId: "m.bob" })).allowed).toBe(false);
        expect((await c({ name: "memory.list" })).allowed).toBe(true);
        expect(await ctx.fns.memory.userModule({ userId: "m.bob" })).toBe("user_m_bob");
        expect(await ctx.fns.memory.fnLevel({ module: "user_m_bob" })).toEqual({ level: "user", owner: "m.bob" });
    });

    test("syncCode indexes each function on its level; ready needs a test; status survives a resync", async () => {
        const r = await ctx.fns.memory.syncCode({});
        expect(r.functions).toEqual([`agent_${agentId}.draw`, `project_${slug}.tables`, "user_alice.style"]);
        const rows: any[] = await ctx.fns.procs.db.select({ sql: "select key, visibility, project_id, user_id, agent_id, meta from memory where type = 'code' order by key", params: [] });
        expect(rows.map(x => [x.key, x.visibility])).toEqual([[`fn/agent_${agentId}.draw`, "agent"], [`fn/project_${slug}.tables`, "project"], ["fn/user_alice.style", "user"]]);
        expect(rows[1].meta).toMatchObject({ status: "draft", params: ["x"], returnType: "{ ok: boolean }" });
        const m = as({ kind: "agent", agentId }).fns.memory;
        await expect(m.setStatus({ key: "fn/user_alice.style", status: "ready" })).rejects.toThrow(/test/);
        await m.setStatus({ key: `fn/project_${slug}.tables`, status: "ready" });
        await ctx.fns.memory.syncCode({});
        const [t]: any[] = await ctx.fns.procs.db.select({ sql: "select meta->>'status' as s from memory where key = ?", params: [`fn/project_${slug}.tables`] });
        expect(t.s).toBe("ready");
    });

    test("the prompt block names the levels and lists ready functions and the agent's own", async () => {
        const hook = (await import("./$hook_agent.promptAugment")).default;
        const text: string = await hook(ctx, null, { agentId, text: "" });
        expect(text).toContain(`project ${slug}`);
        expect(text).toContain("user alice");
        expect(text).toContain(`ctx.fns.project_${slug}.tables`);
        expect(text).toContain(`ctx.fns.agent_${agentId}.draw`);
        expect(text).not.toContain("user_alice.style");                      // draft, not the agent's own
        const other: string = await hook(ctx, null, { agentId: strangerId, text: "" });
        expect(other).not.toContain(`agent_${agentId}`);
        expect(other).toContain("project: none");
    });

    test("a deleted file drops its row", async () => {
        await rm(join(home, `src/agent_${agentId}/draw.ts`));
        expect((await ctx.fns.memory.syncCode({})).removed).toBe(1);
    });
});
