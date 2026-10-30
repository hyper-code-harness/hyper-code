import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("ui.notFound draws a 404 page on w: what was looked for, the address, ways out", async () => {
    const ctx: any = await mkTestCtx();
    const page = await ctx.fns.ui.notFound({ what: "agent xy", url: "/agent/<xy>", back: { label: "All agents", href: "/" } });
    expect(page.status).toBe(404);
    expect(page.main).toContain('data-page="not-found"');
    expect(page.main).toContain("There is no agent xy");
    expect(page.main).toContain("/agent/&lt;xy&gt;");
    expect(page.main).toContain("All agents");
    expect(page.main).toContain('data-action="go-back"');
    expect(page.main).toContain('data-action="home"');
    expect(page.main).toContain('href="/functions"');
    expect(page.main).not.toMatch(/ui-focusable|text-faint/);
    const plain = await ctx.fns.ui.notFound({});
    expect(plain.main).toContain("Page not found");
    expect(plain.main).toContain("404");
});

test("a miss is the 404 page for a browser and four bytes for everything else", async () => {
    const ctx: any = await mkTestCtx();
    const html = await ctx.fns.procs.http.dispatch({ url: "/no/such/page-404", headers: { accept: "text/html" } });
    expect(html.status).toBe(404);
    expect(html.headers.get("content-type") ?? "").toContain("text/html");
    const body = await html.text();
    expect(body).toContain("Page not found");
    expect(body).toContain("/no/such/page-404");
    const api = await ctx.fns.procs.http.dispatch({ url: "/no/such/page-404", headers: { accept: "application/json" } });
    expect(api.status).toBe(404);
    expect(await api.text()).toBe("Not Found");
});
