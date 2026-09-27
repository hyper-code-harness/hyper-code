// Regressions from the Astra review of the remote workspace work.
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkTestCtx } from "../_testCtx.entry";

describe("Files UI: untrusted file contents", () => {
    test("the editor bootstrap cannot be closed by a file containing </script>", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.procs.http.loadRoutes({});
        const dir = await mkdtemp(join(tmpdir(), "hyper-xss-"));
        try {
            await writeFile(join(dir, "evil.ts"), "const a = 1;\n</script><script>window.__pwned = 1</script><!--\n\u2028\n");
            const r = await ctx.fns.procs.http.dispatch({ url: `/files?path=${encodeURIComponent(join(dir, "evil.ts"))}&tab=edit`, headers: { accept: "text/html" } });
            const html = await r.text();
            expect(r.status).toBe(200);
            expect(html).not.toContain("</script><script>window.__pwned");
            expect(html).not.toContain("<!--\n");
            // the content survives as data: the escaped form decodes back to the original
            const m = /window\.__editor = (\{[\s\S]*?\});<\/script>/.exec(html);
            expect(JSON.parse(m![1]!).content).toContain("</script><script>window.__pwned = 1</script>");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe("files.isPageRequest: page vs raw asset", () => {
    const req = (headers: Record<string, string>) => new Request("http://x/files/absolute/a", { headers });
    test("Sec-Fetch-Dest decides when present", async () => {
        const ctx: any = await mkTestCtx({ db: false });
        const f = (h: Record<string, string>, path: string) => ctx.fns.files.isPageRequest({ req: req(h), path });
        expect(f({ "sec-fetch-dest": "document", accept: "*/*" }, "/p/app.js")).toBe(true);
        expect(f({ "sec-fetch-dest": "iframe" }, "/p/readme.md")).toBe(true);
        expect(f({ "sec-fetch-dest": "script", accept: "*/*" }, "/p/app.js")).toBe(false);
        expect(f({ "sec-fetch-dest": "style", accept: "text/css,*/*;q=0.1" }, "/p/style.css")).toBe(false);
        expect(f({ "sec-fetch-dest": "empty", accept: "*/*" }, "/p/data.json")).toBe(false);
    });
    test("without it: text/html is a page, wildcard only for documents, never CSS/JS", async () => {
        const ctx: any = await mkTestCtx({ db: false });
        const f = (h: Record<string, string>, path: string) => ctx.fns.files.isPageRequest({ req: req(h), path });
        expect(f({ accept: "text/html,application/xhtml+xml" }, "/p/app.js")).toBe(true);
        expect(f({ accept: "*/*" }, "/p/readme.md")).toBe(true);
        expect(f({ accept: "*/*" }, "/p/app.js")).toBe(false);
        expect(f({ accept: "*/*" }, "/p/style.css")).toBe(false);
        expect(f({ accept: "text/css,*/*;q=0.1" }, "/p/style.css")).toBe(false);
        expect(f({ accept: "image/png" }, "/p/readme.md")).toBe(false);
    });
    test("an HTML preview's own script is served raw, with its MIME type", async () => {
        const ctx: any = await mkTestCtx();
        await ctx.fns.procs.http.loadRoutes({});
        const dir = await mkdtemp(join(tmpdir(), "hyper-assets-"));
        try {
            await writeFile(join(dir, "app.js"), "console.log(1)\n");
            const url = await ctx.fns.files.browserUrl({ path: join(dir, "app.js") });
            const r = await ctx.fns.procs.http.dispatch({ url, headers: { accept: "*/*", "sec-fetch-dest": "script" } });
            expect(r.headers.get("content-type")).toContain("javascript");
            expect(await r.text()).toBe("console.log(1)\n");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe("files.browserUrl for a host", () => {
    test("refuses relative remote paths instead of rooting them at /", async () => {
        const ctx: any = await mkTestCtx({ db: false });
        expect(await ctx.fns.files.browserUrl({ path: "/home/u/a b", host: "h" })).toBe("/files/remote/h/home/u/a%20b");
        await expect(ctx.fns.files.browserUrl({ path: "projects", host: "h" })).rejects.toThrow("must be absolute");
        await expect(ctx.fns.files.browserUrl({ path: "~/p", host: "h" })).rejects.toThrow("must be absolute");
    });
});
