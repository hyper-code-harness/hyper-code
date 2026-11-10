// Static assets ($style_, $script_) answer conditional GETs: a strong ETag on 200,
// 304 with no body when If-None-Match names it, a new ETag after the file changes.
import { test, expect } from "bun:test";
import { mkdtemp, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testCtx } from "../../$test";

const ctx = await testCtx();

test("serveFile: 200 with ETag, then 304 on If-None-Match (list and W/ forms), new ETag after a change", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serve-file-"));
    const path = join(dir, "a.css");
    await writeFile(path, "body{color:red}");
    const get = (headers?: Record<string, string>) =>
        ctx.fns.procs.http.serveFile({ path, contentType: "text/css; charset=utf-8", req: new Request("http://x/a.css", { headers }) });

    const first = await get();
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(first.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await first.text()).toBe("body{color:red}");

    const again = await get({ "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(await again.text()).toBe("");

    expect((await get({ "if-none-match": `"other", W/${etag}` })).status).toBe(304);
    expect((await get({ "if-none-match": "*" })).status).toBe(304);
    expect((await get({ "if-none-match": '"stale"' })).status).toBe(200);

    // The file changes (mtime pushed forward so the cache key moves even on a fast disk).
    await writeFile(path, "body{color:blue}");
    const later = new Date(Date.now() + 5000);
    await utimes(path, later, later);
    const changed = await get({ "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
});

test("$script_ route: 200 with ETag, then 304 through http.dispatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serve-script-"));
    const abs = join(dir, "$script_probe.js");
    await writeFile(abs, "console.log('probe')");
    const local = await testCtx();
    await (local.state as any).procs.boot.loaders.script(local, null, {
        entries: [{ routePath: "/probe/probe.js", abs, fileName: "$script_probe.js", root: dir, rel: "$script_probe.js" }],
    });
    const first = await local.fns.procs.http.dispatch({ url: "/probe/probe.js" });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(first.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await first.text()).toContain("probe");
    const again = await local.fns.procs.http.dispatch({ url: "/probe/probe.js", headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(await again.text()).toBe("");
});
