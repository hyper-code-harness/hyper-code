import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("GET /files — media preview", () => {
    test("renders png through the raw media endpoint without decoding it as text", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-media-"));
        const path = join(dir, "sample.png");
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        await writeFile(path, bytes);
        try {
            const page = await ctx.fns.procs.http.dispatch({ url: `/files?path=${encodeURIComponent(path)}` });
            const html = await page.text();
            expect(page.status).toBe(200);
            const mediaUrl = await ctx.fns.files.browserUrl({ path });
            expect(html).toContain(`<img src="${mediaUrl}"`);
            expect(html).toContain("Preview");
            expect(html).not.toContain(">Code</a>");
            expect(html).not.toContain(">Edit</a>");

            const raw = await ctx.fns.procs.http.dispatch({ url: `/files/raw?path=${encodeURIComponent(path)}` });
            expect(raw.status).toBe(200);
            expect(raw.headers.get("content-type")).toBe("image/png");
            expect(new Uint8Array(await raw.arrayBuffer())).toEqual(bytes);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("uses native preview elements for video, audio and pdf", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-media-"));
        try {
            for (const [file, element] of [["clip.mp4", "<video"], ["sound.mp3", "<audio"], ["paper.pdf", "<iframe"]] as const) {
                const path = join(dir, file);
                await writeFile(path, new Uint8Array([0]));
                const html = await (await ctx.fns.procs.http.dispatch({ url: `/files?path=${encodeURIComponent(path)}` })).text();
                expect(html).toContain(element);
                expect(html).toContain(await ctx.fns.files.browserUrl({ path }));
                if (file === "paper.pdf") expect(html).toContain(`<iframe data-file-frame src="${await ctx.fns.files.browserUrl({ path })}?raw=1"`);
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("?raw=1 turns a framed file URL from the Files page into the raw bytes", async () => {
        const ctx = await mkTestCtx();
        const req = (q: string) => new Request(`http://x/files/absolute/tmp/paper.pdf${q}`, { headers: { "sec-fetch-dest": "iframe" } });
        expect(ctx.fns.files.isPageRequest({ req: req(""), path: "/tmp/paper.pdf" })).toBe(true);
        expect(ctx.fns.files.isPageRequest({ req: req("?raw=1"), path: "/tmp/paper.pdf" })).toBe(false);
    });
});
