// Real Files markup + compiled production CSS, disposable Chrome and test DB only.
// The negative control removes only the canvas-view height contract; it must reproduce the gap.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";
import { startHeadlessChrome } from "../../test/chrome/headless";

const repo = resolve(import.meta.dir, "../..");
const chrome = await startHeadlessChrome();
let server: ReturnType<typeof Bun.serve> | undefined;
let temp = "";
let ctx: any;
const variants = new Map<string, string>();

beforeAll(async () => {
    if (!chrome) return;
    await mkdir(join(repo, ".test-tmp"), { recursive: true });
    temp = await mkdtemp(join(repo, ".test-tmp/files-viewer-height-"));
    ctx = await mkTestCtx({ env: { HYPER_HOME: join(temp, "home"), CDP_BROWSER_URL: chrome.url } });
    // Deterministic rendering with the same pre/code and Markdown block shapes, no remote fences.
    ctx.state.registry.markdown.render = (_c: any, _s: any, o: { source: string }) => Bun.markdown.html(o.source);
    ctx.state.registry.markdown.highlight = (_c: any, _s: any, o: { code: string }) => `<pre><code>${Bun.escapeHTML(o.code)}</code></pre>`;
    const htmlPath = join(temp, "document.html"), mdPath = join(temp, "long.md"), codePath = join(temp, "long.txt"), dirPath = join(temp, "directory");
    await Bun.write(htmlPath, `<style>.doc{padding:28px 32px 60px;font:15px/1.55 sans-serif}.doc h1{margin:0 0 6px;font-size:28px}</style><div class="doc"><h1>Document begins here</h1>${"<p>Long disposable document.</p>".repeat(100)}<p>END</p></div>`);
    await Bun.write(mdPath, `# Markdown begins here\n\n${"A paragraph.\n\n".repeat(100)}END\n`);
    await Bun.write(codePath, `${"A source line\n".repeat(150)}END\n`);
    await mkdir(dirPath);
    await Promise.all(Array.from({ length: 60 }, (_, i) => Bun.write(join(dirPath, `file-${String(i).padStart(2, "0")}.txt`), "fixture")));

    // Fresh output under the fixture, never a live or stale styles.build cache.
    const framework = join(repo, "src/procs"), pkgPath = Bun.resolveSync("@tailwindcss/cli/package.json", framework);
    const pkg = await Bun.file(pkgPath).json(), cli = join(dirname(pkgPath), typeof pkg.bin === "string" ? pkg.bin : pkg.bin.tailwindcss);
    const sources = ["procs/styles/$style_app.css", "w/$style_w.css", "files/$style_files.css", "rpc/$style_rpc.css", "canvas/$style_canvas.css"];
    const input = `@import ${JSON.stringify(Bun.resolveSync("tailwindcss/index.css", framework))} source(none);\n@plugin ${JSON.stringify(Bun.resolveSync("@tailwindcss/typography", framework))};\n@source ${JSON.stringify(join(repo, "src"))};\n${sources.map(p => `@import ${JSON.stringify(join(repo, "src", p))};`).join("\n")}`;
    await Bun.write(join(temp, "input.css"), input);
    const compile = Bun.spawn([process.execPath, cli, "-i", join(temp, "input.css"), "-o", join(temp, "style.css"), "--minify"], { stdout: "pipe", stderr: "pipe" });
    const [, error, status] = await Promise.all([new Response(compile.stdout).text(), new Response(compile.stderr).text(), compile.exited]);
    if (status !== 0) throw new Error(`Fixture stylesheet compilation failed: ${error}`);

    for (const [mode, path, tab] of [["html", htmlPath, ""], ["markdown", mdPath, ""], ["code", codePath, "code"], ["directory", dirPath, ""]] as const) {
        const body = await ctx.fns.files.page({ path, tab });
        const rpc = ctx.fns.rpc.page({ title: "files.page", value: body });
        const address = ctx.fns.w.addressBar({ url: "/rpc/files.page", href: "#", mono: true });
        const pane = ctx.fns.w.pane({ header: address, body: `<div data-canvas-view="fixture">${rpc}</div>` });
        const canvas = `<section class="canvas-panel">${ctx.fns.w.paneHeader({ title: "File fixture" })}<div data-canvas-body>${pane}</div></section>`;
        const main = `<div data-page="agent" data-canvas-open style="--chat-w:440px" class="flex min-h-0 min-w-0 flex-1 bg-base-200">${canvas}<div class="canvas-resizer"></div><section id="chat-panel" class="flex min-w-0 flex-1 flex-col">${ctx.fns.w.paneHeader({ title: "Chat fixture" })}</section></div>`;
        for (const [key, content] of [[mode, main], [`standalone-${mode}`, rpc]]) {
            const html = await ctx.fns.ui.layout({ main: content, title: "Viewer fixture" });
            variants.set(key!, html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi, "").replace("<html>", '<html data-chrome="flat" data-w-theme="light">').replace("</head>", '<link rel="stylesheet" href="/style.css"></head>'));
        }
    }
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/style.css") return new Response(Bun.file(join(temp, "style.css")));
        const html = variants.get(path.slice(1));
        return html ? new Response(html, { headers: { "content-type": "text/html" } }) : new Response("Not found", { status: 404 });
    } });
}, 30_000);

afterAll(async () => {
    server?.stop(true);
    await chrome?.stop();
    if (temp) await rm(temp, { recursive: true, force: true });
});

async function open(mode: string, width = 1210, height = 834) {
    const target: any = await (await fetch(`${chrome!.url}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();
    ws.onmessage = event => {
        const message = JSON.parse(String(event.data)), job = pending.get(message.id);
        if (!job) return;
        clearTimeout(job.timer); pending.delete(message.id);
        if (message.error) job.reject(message.error); else job.resolve(message.result);
    };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, 5_000);
        pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async (expression: string) => {
        const answer = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
        return answer.result?.value;
    };
    const close = async () => { ws.close(); await fetch(`${chrome!.url}/json/close/${target.id}`); };
    try {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url: `http://127.0.0.1:${server!.port}/${mode}` });
        const deadline = Date.now() + 5_000;
        while (!(await evaluate(`document.readyState==='complete' && !!document.querySelector('[data-file-page]')`))) {
            if (Date.now() > deadline) throw new Error("Files fixture did not load");
            await Bun.sleep(20);
        }
        await evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
        return { evaluate, send, close };
    } catch (error) { await close(); throw error; }
}

const geometry = `(()=>{
    const out={};
    for(const [key,selector] of Object.entries({body:'.w-pane-body',view:'[data-canvas-view]',page:'[data-file-page]',card:'[data-file-card]',header:'[data-file-card]>.w-pane-header',frame:'[data-file-frame]'})){
        const e=document.querySelector(selector);if(!e)continue;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
        out[key]={top:r.top,bottom:r.bottom,height:r.height,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,paddingBottom:parseFloat(s.paddingBottom),headerToken:parseFloat(s.getPropertyValue('--w-header'))};
    }return out;
})()`;

for (const [width, height] of [[1210, 834], [1600, 1000]]) {
    test.skipIf(!chrome)(`HTML canvas preview fills its pane at ${width}×${height}; header does not overlap`, async () => {
        const tab = await open("html", width, height);
        try {
            const g = await tab.evaluate(geometry);
            expect(Math.abs(g.view.height - g.body.height)).toBeLessThanOrEqual(1);
            expect(Math.abs(g.body.bottom - g.card.bottom - g.page.paddingBottom)).toBeLessThanOrEqual(1);
            expect(g.header.height).toBe(32);
            expect(Math.abs(g.frame.top - g.header.bottom)).toBeLessThanOrEqual(1);
            expect(Math.abs(g.frame.bottom - (g.card.bottom - 1))).toBeLessThanOrEqual(1);
            expect(g.frame.height).toBeGreaterThan(600);
            expect(g.body.scrollTop + g.page.scrollTop).toBe(0);
            // One-rule negative control, independent of future CSS formatting or commit hashes.
            await tab.evaluate(`{const s=document.createElement('style');s.textContent='[data-canvas-view]:has(> .rpc-view > [data-canvas-files]) { height:auto; }';document.head.append(s)}`);
            const broken = await tab.evaluate(geometry);
            expect(broken.body.bottom - broken.card.bottom).toBeGreaterThan(150);
            expect(broken.card.height).toBe(512);
        } finally { await tab.close(); }
    }, 15_000);
}

test.skipIf(!chrome)("short panes retain access to the file card bottom", async () => {
    const tab = await open("html", 1210, 600);
    try {
        const g = await tab.evaluate(geometry);
        expect(g.page.scrollHeight).toBeGreaterThan(g.page.clientHeight);
        await tab.evaluate(`document.querySelector('[data-file-page]').scrollTop=100000`);
        const end = await tab.evaluate(geometry);
        expect(end.page.scrollTop).toBeGreaterThan(0);
        expect(end.frame.bottom).toBeLessThanOrEqual(end.body.bottom);
        expect(Math.abs(end.frame.top - end.header.bottom)).toBeLessThanOrEqual(1);
    } finally { await tab.close(); }
}, 15_000);

for (const mode of ["markdown", "code", "directory"]) {
    test.skipIf(!chrome)(`${mode} remains scrollable to its end`, async () => {
        const tab = await open(mode);
        try {
            const g = await tab.evaluate(geometry);
            expect(Math.abs(g.view.height - g.body.height)).toBeLessThanOrEqual(1);
            const end = await tab.evaluate(`(()=>{const p=document.querySelector('[data-file-page]');p.scrollTop=100000;const content=p.querySelector('[data-file-prose], [data-file-code], .w-card');return {scrollTop:p.scrollTop,max:p.scrollHeight-p.clientHeight,contentBottom:content.getBoundingClientRect().bottom,pageBottom:p.getBoundingClientRect().bottom,text:content.textContent}})()`);
            expect(end.scrollTop).toBeGreaterThan(0);
            expect(Math.abs(end.scrollTop - end.max)).toBeLessThanOrEqual(1);
            expect(end.contentBottom).toBeLessThanOrEqual(end.pageBottom);
            expect(end.text).toContain(mode === "directory" ? "file-59.txt" : "END");
        } finally { await tab.close(); }
    }, 15_000);
}

test.skipIf(!chrome)("standalone HTML preview is unaffected by the canvas-only height rule", async () => {
    const tab = await open("standalone-html");
    try {
        const before = await tab.evaluate(geometry);
        expect(before.view).toBeUndefined();
        expect(before.page.height).toBe(834);
        expect(Math.abs(before.page.bottom - before.card.bottom - before.page.paddingBottom)).toBeLessThanOrEqual(1);
        await tab.evaluate(`{const s=document.createElement('style');s.textContent='[data-canvas-view]:has(> .rpc-view > [data-canvas-files]) { height:auto; }';document.head.append(s)}`);
        expect(await tab.evaluate(geometry)).toEqual(before);
    } finally { await tab.close(); }
}, 15_000);
