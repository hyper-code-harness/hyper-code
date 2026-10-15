import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("GET /files/absolute — path-based Files URLs", () => {
    test("renders a Markdown page and lets a relative image resolve as raw bytes", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-files-absolute-"));
        try {
            await mkdir(join(dir, "images"));
            await writeFile(join(dir, "readme.md"), "# Page\n\n![diagram](./images/diagram.png)\n");
            const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            await writeFile(join(dir, "images", "diagram.png"), bytes);
            await ctx.fns.procs.http.loadRoutes({});

            const pageUrl = await ctx.fns.files.browserUrl({ path: join(dir, "readme.md") });
            const page = await ctx.fns.procs.http.dispatch({ url: pageUrl, headers: { accept: "text/html" } });
            const html = await page.text();
            expect(page.status).toBe(200);
            expect(html).toContain("diagram.png");

            const image = await ctx.fns.procs.http.dispatch({
                url: new URL("./images/diagram.png", "http://localhost" + pageUrl).pathname,
                headers: { accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8" },
            });
            expect(image.status).toBe(200);
            expect(image.headers.get("content-type")).toBe("image/png");
            expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("opens relative Markdown links as Files pages", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-files-absolute-"));
        try {
            await writeFile(join(dir, "one.md"), "[next](./two.md)");
            await writeFile(join(dir, "two.md"), "# Two");
            await ctx.fns.procs.http.loadRoutes({});
            const one = await ctx.fns.files.browserUrl({ path: join(dir, "one.md") });
            const two = new URL("./two.md", "http://localhost" + one).pathname;
            const response = await ctx.fns.procs.http.dispatch({ url: two, headers: { accept: "text/html" } });
            expect(response.status).toBe(200);
            expect(await response.text()).toContain("Two");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("preserves embed mode while internally dispatching the Files page", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-files-absolute-"));
        try {
            await writeFile(join(dir, "readme.md"), "# Embedded");
            await ctx.fns.procs.http.loadRoutes({});
            const url = await ctx.fns.files.browserUrl({ path: join(dir, "readme.md") });
            const response = await ctx.fns.procs.http.dispatch({ url: `${url}?embed=1&wide=1`, headers: { accept: "text/html" } });
            const html = await response.text();
            expect(response.status).toBe(200);
            expect(html).toContain("Embedded");
            expect(html).not.toContain('id="dock"');
            expect(html).toContain("max-w-none");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("embed namespace survives relative navigation without query propagation", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-files-embed-"));
        try {
            await writeFile(join(dir, "one.md"), "[next](./two.md)");
            await writeFile(join(dir, "two.md"), "# Embedded two");
            await ctx.fns.procs.http.loadRoutes({});
            const ordinary = await ctx.fns.files.browserUrl({ path: join(dir, "one.md") });
            const one = ordinary.replace("/files/absolute/", "/files/embed/");
            const page = await ctx.fns.procs.http.dispatch({ url: one, headers: { accept: "text/html" } });
            const html = await page.text();
            expect(page.status).toBe(200);
            expect(html).not.toContain('id="dock"');
            expect(html).toContain("/files/embed/");

            const two = new URL("./two.md", "http://localhost" + one).pathname;
            expect(two).toContain("/files/embed/");
            const next = await ctx.fns.procs.http.dispatch({ url: two, headers: { accept: "text/html" } });
            expect(next.status).toBe(200);
            expect(await next.text()).toContain("Embedded two");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });


    test("forwards the authenticated cookie through internal Files dispatch", async () => {
        const ctx: any = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-files-auth-forward-"));
        try {
            await writeFile(join(dir, "readme.md"), "# Authenticated");
            await ctx.fns.procs.http.loadRoutes({});
            const middlewares = ctx.state.procs.http.middleware;
            const absolute = middlewares.find((item: any) => item.prefix === "/files/absolute").handler;
            const embed = middlewares.find((item: any) => item.prefix === "/files/embed").handler;
            const seen: any[] = [];
            ctx.state.registry.procs.http.dispatch = (_c: any, _s: any, opts: any) => { seen.push(opts); return new Response("ok"); };
            const headers = { accept: "text/html", cookie: "procs_session=signed", host: "localhost:3010", "x-forwarded-proto": "http" };
            await absolute(ctx, null, { req: new Request(`http://localhost:3010/files/absolute${join(dir, "readme.md")}`, { headers }), params: {} });
            await embed(ctx, null, { req: new Request(`http://localhost:3010/files/embed${join(dir, "readme.md")}`, { headers }), params: {} });
            expect(seen).toHaveLength(2);
            for (const call of seen) {
                expect(call.headers.cookie).toBe("procs_session=signed");
                expect(call.headers.host).toBe("localhost:3010");
                expect(call.headers["x-forwarded-proto"]).toBe("http");
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });


});
