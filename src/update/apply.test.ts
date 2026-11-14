import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import apply from "./$route_apply_POST";
import page from "./$route__GET";

// 2026-11-12: crm ran src/$main.ts directly under hyperd; "Update and restart" exited 75, hyperd restarted the old
// code without applying anything, and the instance was down. Without run-service.ts the button must not exist and
// the endpoint must refuse BEFORE stopping anything.
test("apply refuses without the run-service supervisor and does not stop the process", async () => {
    const ctx: any = await mkTestCtx();
    delete ctx.env.HYPER_UPDATE_SUPERVISOR;
    let stopped = false;
    ctx.state.registry.procs.lifecycle.stop = async () => { stopped = true; return { stopped: [] }; };
    ctx.state.registry.auth.verifyCsrf = async () => true;
    ctx.state.registry.update.check = async () => { throw new Error("must not even check"); };
    const req = new Request("http://localhost/update/apply", { method: "POST", body: new URLSearchParams({ _csrf: "x" }) });
    const res = await apply(ctx, null, { req, params: {} });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("script/run-service.ts");
    await Bun.sleep(150);
    expect(stopped).toBe(false);
});

test("the update page hides the button without the supervisor but still lists the commits", async () => {
    const ctx: any = await mkTestCtx();
    delete ctx.env.HYPER_UPDATE_SUPERVISOR;
    ctx.state.registry.update.check = async () => ({ state: "available", current: "a", target: "b", upstream: "origin/main", ahead: 0, behind: 1, clean: true, checkedAt: 0, message: "Update available" });
    ctx.state.registry.git.run = async () => ({ ok: true, stdout: "b1\tfix things\n", stderr: "" });
    ctx.state.registry.auth.csrfForms = async (_c: unknown, _s: unknown, o: { html: string }) => o.html;
    const out: any = await page(ctx, null, { req: new Request("http://localhost/update"), params: {} });
    expect(out.main).not.toContain("/update/apply");
    expect(out.main).toContain("cannot update itself");
    expect(out.main).toContain("fix things");
    ctx.env.HYPER_UPDATE_SUPERVISOR = "run-service";
    const ok: any = await page(ctx, null, { req: new Request("http://localhost/update"), params: {} });
    expect(ok.main).toContain("/update/apply");
});

// 2026-11-14: crm (run-service.ts this time) took "Update and restart", stopped its HTTP listener and then hung in a
// $stop hook; exit 75 was never reached, the supervisor waited for the child forever and the instance was down.
test("apply exits with the update code even when shutdown never finishes or throws", async () => {
    const realExit = process.exit, realTimeout = globalThis.setTimeout;
    const exits: number[] = [];
    const delays: number[] = [];
    try {
        (process as any).exit = (code: number) => { exits.push(code); };
        // Timers run at once, in order of their delay; the delays themselves are what is checked.
        (globalThis as any).setTimeout = (fn: () => void, ms: number) => { delays.push(ms); return realTimeout(fn, ms >= 1000 ? 30 : 0); };
        for (const stop of [() => new Promise<never>(() => {}), async () => { throw new Error("stop failed"); }, async () => ({ stopped: [] })]) {
            exits.length = 0; delays.length = 0;
            const ctx: any = await mkTestCtx();
            ctx.env.HYPER_UPDATE_SUPERVISOR = "run-service";
            ctx.state.root = await (await import("node:fs/promises")).mkdtemp((await import("node:os")).tmpdir() + "/hyper-update-apply-");
            ctx.state.registry.procs.lifecycle.stop = stop;
            ctx.state.registry.auth.verifyCsrf = async () => true;
            ctx.state.registry.update.check = async () => ({ state: "available", current: "a".repeat(40), target: "b".repeat(40), upstream: "origin/main", ahead: 0, behind: 1, clean: true, checkedAt: 0, message: "Update available" });
            ctx.state.registry.git.run = async () => ({ ok: true, stdout: "src/x.ts\n", stderr: "" });
            const res = await apply(ctx, null, { req: new Request("http://localhost/update/apply", { method: "POST", body: new URLSearchParams({ _csrf: "x" }) }), params: {} });
            expect(res.status).toBe(202);
            await new Promise(r => realTimeout(r, 120));
            expect(delays).toEqual([100, 10_000]);
            expect(exits.length).toBeGreaterThan(0);
            expect(new Set(exits)).toEqual(new Set([75]));
        }
    } finally { process.exit = realExit; globalThis.setTimeout = realTimeout; }
});
