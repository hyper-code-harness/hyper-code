import { expect, test } from "bun:test";
import render from "./renderEditArgs";

const ctx = {
    fns: {
        procs: { ui: { escape: ({ text }: any) => String(text).replaceAll("<", "&lt;") } }, w: { escape: ({ text }: any) => String(text).replaceAll("<", "&lt;") },
        agent: { toolLang: () => "typescript" },
        markdown: { highlight: async ({ code }: any) => `<pre><code>${String(code).replaceAll("<", "&lt;")}</code></pre>` },
    },
} as unknown as Context;

test("renders edit operations as readable red/green diff cards", async () => {
    const html = await render(ctx, null, {
        path: "src/demo.ts",
        edits: [
            { oldText: "const old = 1;", newText: "const next = 2;" },
            { op: "insertAfter", anchor: "12ab", text: "console.log(next);" },
            { op: "delete", anchor: "20aa", endAnchor: "25bb" },
        ],
    });

    expect(html).toContain("src/demo.ts");
    expect(html).toContain("3 changes");
    expect(html).toContain("edit-remove");
    expect(html).toContain("edit-add");
    expect(html).toContain("const old = 1;");
    expect(html).toContain("const next = 2;");
    expect(html).toContain("Insert after");
    expect(html).toContain("@12ab");
    expect(html).toContain("Delete selected line range");
});
