import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("renders edit operations as readable red/green diff cards", async () => {
    const ctx: any = await mkTestCtx();
    const html = await ctx.fns.agent.renderEditArgs({
        path: "src/demo.ts",
        edits: [
            { oldText: "const old = 1;", newText: "const next = 2;" },
            { op: "insertAfter", anchor: "12ab", text: "console.log(next);" },
            { op: "delete", anchor: "20aa", endAnchor: "25bb" },
        ],
    });

    expect(html).toContain("src/demo.ts");
    expect(html).toContain("3 changes");
    expect(html).toContain('data-diff="remove"');
    expect(html).toContain('data-diff="add"');
    expect(html).toContain("const old = 1;");
    expect(html).toContain("const next = 2;");
    expect(html).toContain("Insert after");
    expect(html).toContain("@12ab");
    expect(html).toContain("Delete selected line range");
});
