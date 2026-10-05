import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("ui.previewFile popup RPC", () => {
    test("returns an iframe fragment instead of JSON metadata", async () => {
        const ctx = await mkTestCtx();
        const dir = await mkdtemp(join(tmpdir(), "hyper-preview-rpc-"));
        try {
            const path = join(dir, "readme.md");
            await writeFile(path, "# Preview");
            // /rpc is cookie-authenticated and CSRF-protected, deliberately
            // independent of Origin — so a dispatch must carry a real signed
            // session cookie and the token derived from it, or the 401 under
            // test is the guard working rather than the handler answering.
            const cookieName = ctx.fns.procs.auth.cookieName({});
            const token = await ctx.fns.procs.auth.sign({ sub: "preview-test", name: "Preview", role: "owner", days: 1 });
            const cookie = `${cookieName}=${token}`;
            const csrf = await ctx.fns.auth.csrfToken({ req: new Request("http://localhost/rpc", { headers: { cookie } }) });
            const response = await ctx.fns.procs.http.dispatch({
                url: "/rpc",
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "hx-request": "true",
                    cookie,
                    "x-csrf-token": csrf,
                },
                body: JSON.stringify({ method: "ui.previewFile", params: { path } }),
            });
            const html = await response.text();
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("text/html");
            expect(html).toContain("data-popup-content");
            expect(html).toContain("<iframe");
            expect(html).toContain("/files/embed/");
            expect(html).not.toContain(`{"path":`);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
