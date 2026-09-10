import { test, expect, describe, mock } from "bun:test";
import render from "./render";
import highlight from "./highlight";

// Hand-built ctx: fns are opts-only (the shape the injecting Proxy exposes to
// call sites), delegating to the raw (ctx, session, opts) implementations.
const mkCtx = (mermaid: (opts: { source: string }) => Promise<string> = async () => "") => {
    const ctx: any = {};
    ctx.fns = { markdown: { highlight: (o: any) => highlight(ctx, null, o), mermaid } };
    return ctx as Context;
};

describe("markdown.render", () => {
    test("basic markdown → HTML", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "# Title\n\n**bold** and *italic*\n- one\n- two" });
        expect(html).toContain("<h1>Title</h1>");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<ul>");
    });
    test("YAML frontmatter renders as a metadata table", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: `---\nname: google\ndescription: "Search & mail"\ntags:\n  - gmail\n  - calendar\n---\n\n# Google` });
        expect(html).toContain('class="md-frontmatter"');
        expect(html).toContain("<th>name</th><td>google</td>");
        expect(html).toContain("Search &amp; mail");
        expect(html).toContain("- gmail");
        expect(html).toContain("<h1>Google</h1>");
        expect(html).not.toContain("<hr>");
    });

    test("invalid YAML frontmatter remains ordinary markdown", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "---\nname: [broken\n---\n\nbody" });
        expect(html).not.toContain('class="md-frontmatter"');
        expect(html).toContain("body");
    });



    test("code block gets shiki-highlighted", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "```js\nconst x = 42;\n```" });
        expect(html).toContain("class=\"shiki github-light\"");
        expect(html).toContain("style=\"color:");
        expect(html).not.toContain("<pre><code class=\"language-js\">");
    });

    test("inline code stays as <code>", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "use `Bun.file` please" });
        expect(html).toContain("<code>Bun.file</code>");
    });

    test("unknown language falls back to plain code", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "```brainfuck\n+++.\n```" });
        expect(html).toContain("<pre><code>");
        expect(html).toContain("+++.");
    });

    test("html entities inside code are decoded before highlighting", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "```ts\nconst a: number = 1 < 2;\n```" });
        expect(html).toContain("shiki");
        expect(html).toContain("1");
        expect(html).toContain("2");
    });

    test("mermaid blocks are pre-rendered before markdown html", async () => {
        const mermaid = mock(async (opts: { source: string }) => {
            return "<div class=\"mermaid-diagram\" data-code=\"" + opts.source.replace(/"/g, "&quot;") + "\"><svg></svg></div>";
        });
        const ctx = mkCtx(mermaid);
        const html = await render(ctx, null, { source: ["# Diagram", "", "```mermaid", "flowchart LR", "A --> B", "```"].join("\n") });
        expect(mermaid).toHaveBeenCalledTimes(1);
        expect(html).toContain("class=\"mermaid-diagram\"");
        expect(html).toContain("<svg></svg>");
        expect(html).not.toContain("language-mermaid");
    });

    test("mermaid render failure falls back to plain code block", async () => {
        const mermaid = mock(async () => { throw new Error("boom"); });
        const ctx = mkCtx(mermaid);
        const html = await render(ctx, null, { source: ["```mermaid", "flowchart LR", "A --> B", "```"].join("\n") });
        expect(html).toContain("<pre><code>");
        expect(html).toContain("flowchart LR");
        expect(html).toContain("A --&gt; B");
    });

    test("rewrites file links relative to the agent workspace", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, {
            source: "[relative](docs/read%20me.md) [absolute](/Users/me/project/a.md#part) [web](https://example.com) [anchor](#x)",
            fileBaseDir: "/Users/me/project",
        });
        expect(html).toContain('href="/files/absolute/Users/me/project/docs/read%20me.md"');
        expect(html).toContain('href="/files/absolute/Users/me/project/a.md#part"');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('href="#x"');
    });

    test("GFM-style autolinks plain URLs, www hosts and email outside code", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "See https://example.com/a_(b). Then www.example.org/test. Mail me@example.com; keep `https://code.test` literal." });
        expect(html).toContain('<a href="https://example.com/a_(b)">https://example.com/a_(b)</a>.');
        expect(html).toContain('<a href="http://www.example.org/test">www.example.org/test</a>.');
        expect(html).toContain('<a href="mailto:me@example.com">me@example.com</a>');
        expect(html).toContain('<code>https://code.test</code>');
        expect(html).not.toContain('<code><a');
    });

    test("does not relink explicit markdown links", async () => {
        const ctx = mkCtx();
        const html = await render(ctx, null, { source: "[Example](https://example.com) and <https://other.example>" });
        expect(html.match(/<a /g)?.length).toBe(2);
    });


});
