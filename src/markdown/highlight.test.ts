import { test, expect, describe } from "bun:test";
import highlight from "./highlight";

const ctx = {} as Context;

describe("markdown.highlight", () => {
    test("known language — shiki output with inline colors", async () => {
        const html = await highlight(ctx, null, { code: "const x = 1;", lang: "js" });
        expect(html).toContain("class=\"shiki shiki-themes github-light github-dark github-light-high-contrast\"");
        expect(html).toContain("--shiki-contrast:");
        expect(html).toContain("--shiki-dark:");
    });

    test("alias ts → typescript", async () => {
        const html = await highlight(ctx, null, { code: "let a: number = 1;", lang: "ts" });
        expect(html).toContain("shiki");
    });

    test("alias sh → bash", async () => {
        const html = await highlight(ctx, null, { code: "ls -la", lang: "sh" });
        expect(html).toContain("shiki");
    });

    test("unknown language — plain <pre><code> fallback, escaped", async () => {
        const html = await highlight(ctx, null, { code: "1 < 2 & 3 > 0", lang: "brainfuck" });
        expect(html).toContain("<pre><code>");
        expect(html).toContain("1 &lt; 2");
        expect(html).toContain("&amp;");
    });
});
