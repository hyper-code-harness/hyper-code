import { expect, test } from "bun:test";
import { testCtx } from "../$test";
import { dirname, join } from "node:path";

const ctx = await testCtx({});

test("authoring returns the canonical core guide from its loaded source location", async () => {
    const metadata = await ctx.fns.runtime.docs.get({ name: "plugins.authoring" });
    const expected = await Bun.file(join(dirname(metadata.abs), "SKILL.md")).text();
    const markdown = await ctx.fns.plugins.authoring({});
    expect(markdown).toBe(expected);
    expect(markdown).toContain("# Plugin authoring");
    expect(markdown).toContain("USER_PLUGINS");
    expect(markdown).toContain("procs.configuration");
});

test("authoring exposes a discoverable documented zero-option runtime API", async () => {
    const metadata = await ctx.fns.runtime.docs.get({ name: "plugins.authoring" });
    expect(metadata.summary).toContain("creating and configuring Hyper plugins");
    expect(metadata.paramsSchema.properties).toEqual({});
    expect(metadata.returnType).toBe("Promise<string>");
});
