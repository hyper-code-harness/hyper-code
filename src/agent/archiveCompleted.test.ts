import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function fixture() {
    const ctx: any = await mkTestCtx();
    ctx.state.registry.agent.wakeWorker = () => {};
    const parent = await ctx.fns.agent.start({ model: "mock:echo", title: "Parent" });
    const child = await ctx.fns.session.fork({ id: parent.id, offset: 0 });
    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: { delegation: { parentId: parent.id, status: "ready", summary: "old completed task" } } });
    await age(ctx, child.id);
    return { ctx, parent, child };
}
async function age(ctx: any, id: string) {
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET updated_at=? WHERE id=?", params: [Date.now() - 120_000, id] });
}
async function archived(ctx: any, id: string) {
    return (await ctx.fns.procs.db.select({ sql: "SELECT archived_at FROM agents WHERE id=?", params: [id] }))[0].archived_at;
}
async function execJob(ctx: any, id: string, runner = "attached") {
    const jobId = `archive-test-${Bun.randomUUIDv7()}`;
    const now = Date.now();
    // Durable row only; no process, timer or external service is started by this fixture.
    await ctx.fns.procs.db.run({ sql: `INSERT INTO jobs (id,agent_id,kind,runner,status,spec,state,execution_id,created_at,started_at,updated_at)
        VALUES (?,?,'exec',?,'running','{}'::jsonb,'{}'::jsonb,?,?,?,?)`, params: [jobId, id, runner, jobId, now, now, now] });
    return jobId;
}

describe("automatic delegated-agent archival", () => {
    test("old ready status does not cancel a new background eval and watch", async () => {
        const { ctx, parent, child } = await fixture();
        await ctx.fns.agent.message({ agent: parent, to: child.id, text: "Run another task in the background" });
        const evalId = await execJob(ctx, child.id);
        const watch = await ctx.fns.jobs.schedule({ agentId: child.id, runner: "watch", prompt: "Check completion", nextAt: Date.now() + 300_000 });
        // The new turn has been consumed; it left background work and retained the old ready metadata.
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at=NULL,last_processed_msg_idx=(SELECT MAX(idx) FROM messages WHERE agent_id=?) WHERE id=?", params: [child.id, child.id] });
        await age(ctx, child.id);
        expect((await ctx.fns.agent.archiveCompleted({ olderThanMs: 60_000 })).archived).not.toContain(child.id);
        expect(await archived(ctx, child.id)).toBeNull();
        const jobs = await ctx.fns.procs.db.select({ sql: "SELECT id,status FROM jobs WHERE id IN (?,?) ORDER BY id", params: [evalId, watch.id] });
        expect(jobs.map((j: any) => j.status)).toEqual(["running", "running"]);
    });

    for (const runner of ["at", "cron", "watch"]) test(`retains ready child with a future ${runner} even when no turn is queued`, async () => {
        const { ctx, child } = await fixture();
        const job = await ctx.fns.jobs.schedule({ agentId: child.id, runner, prompt: "Later", nextAt: Date.now() + 86_400_000 });
        await age(ctx, child.id);
        expect((await ctx.fns.agent.archiveCompleted({ olderThanMs: 60_000 })).archived).toEqual([]);
        expect((await ctx.fns.jobs.get({ id: job.id })).status).toBe("running");
    });

    for (const runner of ["bash", "attached", "attach"]) test(`retains running ${runner} job regardless of runner kind`, async () => {
        const { ctx, child } = await fixture();
        const id = await execJob(ctx, child.id, runner);
        if (runner === "attach") await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET kind='subscription' WHERE id=?", params: [id] });
        await age(ctx, child.id);
        expect((await ctx.fns.agent.archiveCompleted({})).archived).toEqual([]);
        expect(await archived(ctx, child.id)).toBeNull();
    });

    test("retains running, queued, leased and unread ready children", async () => {
        for (const state of ["running", "queued", "leased", "unread"]) {
            const { ctx, child } = await fixture();
            if (state === "running") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state='running' WHERE id=?", params: [child.id] });
            if (state === "queued") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at=? WHERE id=?", params: [Date.now() + 100_000, child.id] });
            if (state === "leased") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_token='active-lease' WHERE id=?", params: [child.id] });
            if (state === "unread") await ctx.fns.session.appendUserMessage({ id: child.id, text: "New work, not queued yet" });
            await age(ctx, child.id);
            expect((await ctx.fns.agent.archiveCompleted({})).archived).toEqual([]);
            expect(await archived(ctx, child.id)).toBeNull();
        }
    });

    test("archives truly idle ready children, ignoring completed jobs and excluded context rows", async () => {
        const { ctx, child } = await fixture();
        const job = await execJob(ctx, child.id);
        await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET status='succeeded' WHERE id=?", params: [job] });
        await ctx.fns.session.appendMessage({ id: child.id, message: { role: "user", content: "status context", excluded_from_cursor: true } });
        await age(ctx, child.id);
        expect((await ctx.fns.agent.archiveCompleted({})).archived).toEqual([child.id]);
        expect(await archived(ctx, child.id)).not.toBeNull();
        expect((await ctx.fns.agent.archiveCompleted({})).archived).toEqual([]);
    });

    test("rechecks active work and metadata after candidate selection", async () => {
        for (const change of ["job", "message", "queued", "running", "status", "fresh"]) {
            const { ctx, child } = await fixture();
            const original = ctx.state.registry.session.archive;
            let injected = false;
            let cancellations = 0;
            ctx.state.registry.jobs.cancelAgent = async () => { cancellations++; };
            ctx.state.registry.session.archive = async (c: any, s: any, opts: any) => {
                injected = true;
                if (change === "job") await execJob(ctx, child.id);
                if (change === "message") {
                    await ctx.fns.session.appendUserMessage({ id: child.id, text: "just arrived" });
                    await age(ctx, child.id); // prove the unread guard, not only updated_at
                }
                if (change === "queued") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at=? WHERE id=?", params: [Date.now() + 10_000, child.id] });
                if (change === "running") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state='running' WHERE id=?", params: [child.id] });
                if (change === "fresh") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET updated_at=? WHERE id=?", params: [Date.now(), child.id] });
                if (change === "status") {
                    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: { delegation: { status: "working" } } });
                    await age(ctx, child.id);
                }
                return original(c, s, opts);
            };
            expect((await ctx.fns.agent.archiveCompleted({})).archived).toEqual([]);
            expect(injected).toBe(true);
            expect(await archived(ctx, child.id)).toBeNull();
            expect(cancellations).toBe(0);
        }
    });

    test("manual archival still deliberately cancels active jobs", async () => {
        const { ctx, child } = await fixture();
        const watch = await ctx.fns.jobs.schedule({ agentId: child.id, runner: "watch", prompt: "Later", nextAt: Date.now() + 60_000 });
        expect((await ctx.fns.session.archive({ id: child.id })).ok).toBe(true);
        expect((await ctx.fns.jobs.get({ id: watch.id })).status).toBe("cancelled");
    });

    test("a real background eval survives cleanup and delivers its result", async () => {
        const { ctx, child } = await fixture();
        const { default: route } = await import("../jobs/$route_eval_POST");
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => route(ctx, null, { req }) });
        ctx.state.procs.http.server = { server, port: server.port };
        await ctx.fns.settings.set({ module: "repl", scopeType: "global", key: "typecheckEval", value: false });
        let jobId: string | undefined;
        let watchId: string | undefined;
        try {
            const response = await ctx.fns.tools.call({ name: "eval", agent: child, args: {
                code: "await Bun.sleep(1200); console.log('autoarchive-survived')", background: true,
            } });
            expect(response.isError).toBe(false);
            jobId = /job (j[0-9a-f]+)/.exec(String(response.output))![1]!;
            watchId = (await ctx.fns.jobs.schedule({ agentId: child.id, runner: "watch", prompt: "Wait for result", nextAt: Date.now() + 300_000 })).id;
            await age(ctx, child.id);
            expect((await ctx.fns.agent.archiveCompleted({ olderThanMs: 60_000 })).archived).toEqual([]);
            const deadline = Date.now() + 12_000;
            while ((await ctx.fns.jobs.get({ id: jobId })).status === "running" && Date.now() < deadline) {
                await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET next_at=0 WHERE id=?", params: [jobId] });
                await ctx.fns.jobs.poll({});
                await Bun.sleep(100);
            }
            expect((await ctx.fns.jobs.get({ id: jobId })).status).toBe("succeeded");
            expect((await ctx.fns.jobs.logs({ id: jobId })).text).toContain("autoarchive-survived");
            const messages = await ctx.fns.session.getMessages({ id: child.id });
            expect(messages.filter((m: any) => m.message_type === "job")).toHaveLength(1);
            expect((await ctx.fns.jobs.get({ id: watchId })).status).toBe("running");
            expect(await archived(ctx, child.id)).toBeNull();
            await ctx.fns.jobs.cancel({ id: watchId });
            // Completion is now queued/unread; it must be processed before cleanup too.
            await age(ctx, child.id);
            expect((await ctx.fns.agent.archiveCompleted({})).archived).toEqual([]);
        } finally {
            if (jobId) await ctx.fns.jobs.cancel({ id: jobId });
            if (watchId) await ctx.fns.jobs.cancel({ id: watchId });
            server.stop(true);
        }
    }, 20_000);

});
