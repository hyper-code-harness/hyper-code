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
