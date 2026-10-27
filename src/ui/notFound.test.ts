import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("ui.notFound draws a 404 page on w: what was looked for, the address, a way back", async () => {
    const ctx: any = await mkTestCtx();
    const page = await ctx.fns.ui.notFound({ what: "agent xy", url: "/agent/<xy>", back: { label: "All agents", href: "/" } });
    expect(page.status).toBe(404);
    expect(page.main).toContain('data-page="not-found"');
    expect(page.main).toContain("w-empty");
    expect(page.main).toContain("There is no agent xy");
    expect(page.main).toContain("/agent/&lt;xy&gt;");
    expect(page.main).toContain("All agents");
    expect(page.main).not.toMatch(/ui-focusable|text-faint/);
    const plain = await ctx.fns.ui.notFound({});
    expect(plain.main).toContain("There is nothing at this address");
});
