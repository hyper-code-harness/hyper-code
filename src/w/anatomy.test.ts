import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("anatomy: a card is made of icons and reads only named tokens", async () => {
    const ctx: any = await mkTestCtx();
    const a = await ctx.fns.w.anatomy({ name: "card" });
    expect(a.widgets).toContain("icon");
    expect(a.classes).toContain("w-card");
    expect(a.tokens.colour).toContain("surface-document");
    expect(a.tokens.shape).toContain("rule");
    expect(await ctx.fns.w.anatomy({ name: "noSuchWidget" })).toEqual({ name: "noSuchWidget", widgets: [], classes: [], tokens: {} });
});
