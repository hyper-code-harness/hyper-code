// FUNCTIONAL test: src/styles.test.ts ↔ src/styles/ + the $style_ convention.
import { test, expect } from "bun:test";
import { testCtx } from "../$test";
import classify from "./project/classify";

const ctx = await testCtx();

test("$style_<name>.css is a stylesheet, routed by its module and name", () => {
    expect(classify(ctx, null, { rel: "procs/styles/$style_app.css" })).toMatchObject({ kind: "style", routePath: "/procs/styles/app.css" });
    expect(classify(ctx, null, { rel: "app/$style_theme.css" })).toMatchObject({ kind: "style", routePath: "/app/theme.css" });
    // a $script .css is still a raw asset, not a stylesheet
    expect(classify(ctx, null, { rel: "chat/$script_x.css" }).kind).toBe("script");
    expect(classify(ctx, null, { rel: "$style_.css" }).kind).toBe("skip");
});

test("loadRoutes registers the compiled stylesheet and the layout links it", async () => {
    await ctx.fns.procs.http.loadRoutes({});
    // the workspace's own $style_app.css is in the scan
    expect(ctx.state.procs?.styles.map((s: any) => s.href)).toContain("/procs/styles/app.css");
    // and it leads the list (a project/module style cascades after it)
    expect(ctx.state.procs.styles![0]!.href).toBe("/procs/styles/app.css");
    expect(ctx.state.procs?.http.routes["/procs/styles/app.css"]?.GET).toBeFunction();
});

test("the framework's own sheet leads whatever order the scan hands them in", async () => {
    const ctx = await testCtx();
    const entry = (routePath: string) => ({ routePath, abs: `/tmp${routePath}`, root: "/tmp", rel: routePath });
    ctx.state.procs.styles = [];
    // an app's sheet discovered FIRST — the sort is the only thing that puts the
    // framework's back in front, so a module's rules still cascade over it.
    await (ctx.state as any).procs.boot.loaders.style(ctx, null, { entries: [entry("/app/theme.css"), entry("/procs/styles/app.css")] });
    expect(ctx.state.procs.styles!.map((s: any) => s.href)).toEqual(["/procs/styles/app.css", "/app/theme.css"]);
});

test("the stylesheet route answers 200 with a strong ETag, then 304 on If-None-Match", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const ctx = await testCtx();
    const dir = await mkdtemp(join(tmpdir(), "styles-etag-"));
    const compiled = join(dir, "app.css");
    await writeFile(compiled, ".x{color:red}");
    // The loader asks build for the compiled path; a stub stands in for Tailwind here.
    const registry = ctx.state.registry as any;
    registry.procs = { ...registry.procs, styles: { ...registry.procs.styles, build: async () => compiled } };
    ctx.state.procs.styles = [];
    await (ctx.state as any).procs.boot.loaders.style(ctx, null, { entries: [{ routePath: "/procs/styles/app.css", abs: `${dir}/$style_app.css`, root: dir, rel: "$style_app.css" }] });
    const first = await ctx.fns.procs.http.dispatch({ url: "/procs/styles/app.css" });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(first.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await first.text()).toBe(".x{color:red}");
    const again = await ctx.fns.procs.http.dispatch({ url: "/procs/styles/app.css", headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(await again.text()).toBe("");
});
