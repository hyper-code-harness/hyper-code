import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";
import urlKind from "./$canvas_url";

test("GET /canvas/framesExtension.zip serves the canvas frames extension as a zip Chrome can load unpacked", async () => {
    const ctx: any = await mkTestCtx();
    const res = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost/canvas/framesExtension.zip" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("hyper-canvas-frames.zip");

    const dir = await mkdtemp(join(tmpdir(), "frames-ext-"));
    try {
        await Bun.write(join(dir, "ext.zip"), await res.arrayBuffer());
        const unzip = Bun.spawnSync(["unzip", "-q", "ext.zip"], { cwd: dir });
        expect(unzip.exitCode).toBe(0);
        const manifest = JSON.parse(await readFile(join(dir, "hyper-canvas-frames", "manifest.json"), "utf8"));
        const source = JSON.parse(await readFile(join(ctx.fns.procs.project.projectRoot({}), "extensions", "canvas-frames", "manifest.json"), "utf8"));
        expect(manifest).toEqual(source);
        expect(await readFile(join(dir, "hyper-canvas-frames", "worker.js"), "utf8")).toContain("declarativeNetRequest");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 30_000);

test("a url tab for a site that forbids framing offers the extension download next to the open-in-new-tab link", async () => {
    const ctx: any = await mkTestCtx();
    const item: any = { id: 1, title: "google.com", args: { url: "https://www.google.com/", embeddable: false, reason: "X-Frame-Options: SAMEORIGIN" } };
    const html = String(urlKind.render(ctx, { agentId: "a", item }));
    expect(html).toContain('href="/canvas/framesExtension.zip"');
    expect(html).toContain("chrome://extensions");
    expect(html).toContain("Open in a new tab");
    expect(html).toContain("data-needs-frames");
    expect(html).toContain("<div data-frames-notice>");
});

test("a url tab follows the address the extension reported, until the tab is pointed somewhere else", async () => {
    const ctx: any = await mkTestCtx();
    const opened = "https://www.google.com/";
    const moved = "https://www.google.com/search?q=hyper";
    const item: any = { id: 1, title: "google.com", args: { url: opened, embeddable: false }, state: { url: moved, title: "hyper - Google", from: opened } };
    const html = String(urlKind.render(ctx, { agentId: "a", item }));
    expect(html).toContain(`<iframe src="${Bun.escapeHTML(moved)}"`);
    expect(html).toContain(`value="${Bun.escapeHTML(moved)}"`);
    expect(html).toContain(`data-canvas-url-from="${opened}"`);
    expect(String(urlKind.describe!(ctx, { item }))).toContain(`now at ${moved}`);

    // The address bar or the agent pointed the tab elsewhere: the old report no longer applies.
    const renavigated: any = { ...item, args: { url: "https://example.com/", embeddable: true } };
    const again = String(urlKind.render(ctx, { agentId: "a", item: renavigated }));
    expect(again).toContain('<iframe src="https://example.com/"');
    expect(again).not.toContain("search?q=hyper");
});

test("the extension reports frame navigation only from frames directly inside a Hyper page", async () => {
    const ctx: any = await mkTestCtx();
    const dir = join(ctx.fns.procs.project.projectRoot({}), "extensions", "canvas-frames");
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    const frameScript = manifest.content_scripts.find((c: any) => c.js.includes("frame.js"));
    expect(frameScript.all_frames).toBe(true);
    const source = await readFile(join(dir, "frame.js"), "utf8");
    expect(source).toContain("window.parent !== window.top");
    expect(source).toContain("ancestorOrigins");
    expect(source).toContain("hyperFrames: 1");
}, 30_000);

test("a url tab has back and forward over the addresses it was pointed at, in an outlined address bar", async () => {
    const ctx: any = await mkTestCtx();
    const fresh: any = { id: 1, title: "example.com", args: { url: "https://example.com/", embeddable: true }, state: {} };
    const a = String(urlKind.render(ctx, { agentId: "a", item: fresh }));
    expect(a).toContain("data-outlined");
    expect(a).toMatch(/<button[^>]*disabled[^>]*data-canvas-step="back"|data-canvas-step="back"[^>]*disabled/);
    const moved: any = { ...fresh, state: { back: ["https://example.org/"], forward: [] } };
    const b = String(urlKind.render(ctx, { agentId: "a", item: moved }));
    expect(b).toContain('data-action="canvas-back"');
    expect(b).not.toContain('data-action="canvas-forward"');
});
