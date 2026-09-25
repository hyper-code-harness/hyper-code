import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// The rail links a workdir by its ABSOLUTE path, so the file browser has to be
// navigable from one. The old breadcrumbs split "/a/b" into ["", "a", "b"] and
// rendered the empty segment as a link with no label — and every crumb below it
// lost the leading slash, pointing at a relative path resolved against another
// base.
describe("GET /files — breadcrumbs", () => {
    test("a relative path is anchored at 'workspace'", async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: "/files?path=src" });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(`<a href="${await ctx.fns.files.browserUrl({ path: "" })}" class="font-semibold text-primary hover:underline">workspace</a>`);
        expect(html).toContain(`href="${await ctx.fns.files.browserUrl({ path: "src" })}"`);
    });

    test("an absolute path keeps the leading slash in every crumb", async () => {
        const ctx = await mkTestCtx();
        const dir = process.cwd() + "/src";
        const res = await ctx.fns.procs.http.dispatch({ url: `/files?path=${encodeURIComponent(dir)}` });
        expect(res.status).toBe(200);
        const html = await res.text();

        // Root crumb is "/", not an unlabelled link.
        expect(html).toContain(`<a href="${await ctx.fns.files.browserUrl({ path: "/" })}" class="font-semibold text-primary hover:underline">/</a>`);
        expect(html).not.toContain(`hover:underline"></a>`);
        // Every intermediate crumb is absolute too.
        for (const part of dir.split("/").filter(Boolean).map((_, i, all) => "/" + all.slice(0, i + 1).join("/"))) {
            expect(html).toContain(`href="${await ctx.fns.files.browserUrl({ path: part })}"`);
        }
    });

    test("a directory listing joins an absolute parent without doubling the slash", async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: `/files?path=${encodeURIComponent(process.cwd())}` });
        const html = await res.text();
        expect(html).toContain(`href="${await ctx.fns.files.browserUrl({ path: process.cwd() + "/src" })}"`);
        // Not a blanket search: the page's favicon is a data: URI full of %2F.
        expect(html).not.toContain(`/files?path=${encodeURIComponent(process.cwd())}%2F%2F`);
        // Phosphor icons, like the rest of the UI.
        expect(html).toContain("ph-folder");
        expect(html).not.toContain("📁");
    });
});

// The rail swaps a page into #main, so /files is now reached as a FRAGMENT far
// more often than as a whole document. Anything the page needs in order to work
// has to travel inside `main` — an htmx request never receives <head>.
describe("GET /files — reachable as an htmx fragment", () => {
    const hx = { "hx-request": "true" };

    test("a directory listing swaps in without the document shell", async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: "/files?path=src", headers: hx });
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).not.toContain("<!doctype");
        expect(html).toContain("/files/absolute/");
    });

    test("the editor boots from inside main, not from head", async () => {
        const ctx = await mkTestCtx();
        const url = `/files?path=${encodeURIComponent("src/files/read.ts")}&tab=edit`;

        const frag = await (await ctx.fns.procs.http.dispatch({ url, headers: hx })).text();
        expect(frag).not.toContain("<!doctype");
        expect(frag).toContain('id="cm-editor"');
        expect(frag).toContain("window.__editor");
        expect(frag).toContain("/files/editor.js");
        // `defer` is meaningless on a swapped-in script and would only delay it
        // past the config it depends on.
        expect(frag).not.toContain('src="/files/editor.js" defer');

        // The whole-document path must carry exactly the same bootstrap.
        const full = await (await ctx.fns.procs.http.dispatch({ url })).text();
        expect(full).toContain("<!doctype");
        expect(full).toContain("window.__editor");
        expect(full).toContain("/files/editor.js");
    });

    test("a markdown preview needs no head either", async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: "/files?path=README.md&tab=preview", headers: hx });
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).toContain("prose");
    });

    test("a file view uses the same centered GitHub-width container as a directory", async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: "/files?path=README.md&tab=preview", headers: hx });
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).toContain("mx-auto flex min-h-full w-full max-w-5xl flex-col");
        expect(html).toContain("rounded-md border border-ui-border bg-base-100 shadow-sm");
        expect(html).toContain("dot-grid-surface");
    });

});
