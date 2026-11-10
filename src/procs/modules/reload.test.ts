import { expect, test } from "bun:test";
import { testCtx } from "../../$test";

// Regression: modules.reload remounted routes but left the compiled css as it was, so a class or a $style that
// arrived with a plugin or a git pull had no rules until a restart (prod runs no watcher that would rebuild).
test("reload recompiles the stylesheets after the routes", async () => {
    const ctx: any = await testCtx();
    const order: string[] = [];
    const procs = ctx.state.registry.procs;
    procs.modules.fetch = async () => { order.push("fetch"); };
    procs.boot.load = async () => { order.push("load"); };
    procs.dev.lint = async () => ({ ok: true, errors: [] });
    procs.dev.genTypes = async () => { order.push("types"); };
    procs.http.loadRoutes = async () => { order.push("routes"); };
    procs.styles.rebuild = async () => { order.push("styles"); };
    procs.events.reload = () => { order.push("reload"); };
    procs.modules.list = async () => [];
    await ctx.fns.procs.modules.reload({});
    expect(order).toEqual(["fetch", "load", "types", "routes", "styles", "reload"]);
});
