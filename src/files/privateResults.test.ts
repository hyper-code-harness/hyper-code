import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("private results reject Files HTTP routes, symlink aliases and directory listing", async () => {
    const ctx = await mkTestCtx();
    const dir = await mkdtemp(join(tmpdir(), "hyper-private-results-"));
    try {
        const store = join(dir, ".hyper/results");
        await mkdir(store, { recursive: true });
        const secret = join(store, "payload.json");
        await writeFile(secret, "PRIVATE_PAYLOAD_SENTINEL");
        await symlink(store, join(dir, "alias"));
        await writeFile(join(dir, "public.txt"), "public");
        expect(await ctx.fns.files.isPrivateResult({ path: secret })).toBe(true);
        expect(await ctx.fns.files.isPrivateResult({ path: join(dir, "alias/payload.json") })).toBe(true);
        expect(await ctx.fns.files.isPrivateResult({ path: join(dir, "public.txt") })).toBe(false);
        await ctx.fns.procs.http.loadRoutes({});
        for (const path of [secret, join(dir, "alias/payload.json"), store]) {
            for (const url of ["/files?path=" + encodeURIComponent(path), "/files/raw?path=" + encodeURIComponent(path), "/files/absolute" + path, "/files/embed" + path]) {
                const response = await ctx.fns.procs.http.dispatch({ url, headers: { accept: "text/html" } });
                expect(response.status).toBe(404);
                expect(await response.text()).not.toContain("PRIVATE_PAYLOAD_SENTINEL");
            }
        }
        const root = await ctx.fns.files.view({ path: dir, isDir: true });
        expect(root.html).not.toContain('>alias<');
        const hyper = await ctx.fns.files.view({ path: join(dir, ".hyper"), isDir: true });
        expect(hyper.html).not.toContain('>results<');
        const normal = await ctx.fns.files.rawResponse({ path: join(dir, "public.txt") });
        expect(normal.status).toBe(200);
        expect(await normal.text()).toBe("public");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
