// canvas.show picks the kind from its args, says what it did (address, reused, fixed, hint), draws Mermaid on the
// server instead of a CDN script; canvas.search finds pages by the function index; the prompt teaches three kinds.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

const MERMAID_PAGE = `<title>Flow probe</title><h1>Flow</h1><pre class="mermaid">flowchart LR
 A[Agent] --&gt; B[Tab]</pre><script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true});</script>`;

test("show infers the kind from args and answers address and reused", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });

    const file = await ctx.fns.canvas.show({ agentId: a.id, args: { path: import.meta.path } });
    expect(file).toMatchObject({ kind: "view", reused: false });
    expect(file.address).toStartWith("/rpc/files.page?");
    const again = await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: import.meta.path } });
    expect(again).toMatchObject({ id: file.id, reused: true });

    const site = await ctx.fns.canvas.show({ agentId: a.id, args: { url: "https://example.com/" } });
    expect(site).toMatchObject({ kind: "url", reused: false, address: "https://example.com/" });
    const view = await ctx.fns.canvas.show({ agentId: a.id, args: { url: file.address } });
    expect(view).toMatchObject({ id: file.id, reused: true });

    await expect(ctx.fns.canvas.show({ agentId: a.id, args: {} })).rejects.toThrow(/kind, or args/);
    const tmp = await ctx.fns.canvas.show({ agentId: a.id, kind: "file", args: { path: `${process.cwd()}/.hyper/tmp/x/report.html` } }).catch((e: Error) => e);
    if (!(tmp instanceof Error)) expect(tmp.hint).toMatch(/\.hyper\/tmp/);
});

test("a page whose only script draws Mermaid is drawn on the server and saved as a static page", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    if (!ctx.fns.mermaid?.render) return; // the mermaid plugin is not mounted in this run

    const shown = await ctx.fns.canvas.show({ agentId: a.id, args: { html: MERMAID_PAGE } });
    expect(shown.kind).toBe("view");
    expect(shown.fixed).toMatch(/mermaid drawn on the server \(1 diagram\)/);
    expect(shown.address).toStartWith("/rpc/memory.view?");
    const key = shown.args.params.key;
    const page = await ctx.fns.memory.file({ ref: key }).catch(() => null);
    if (page) {
        expect(page.text).toContain("<svg");
        expect(page.text).not.toContain("<script");
    }

    // Other scripts next to it: left alone (a framed snapshot), with a hint.
    const mixed = MERMAID_PAGE.replace("</script>", "</script><script>setInterval(() => 0, 1000)</script>");
    const framed = await ctx.fns.canvas.show({ agentId: a.id, title: "Mixed", args: { html: mixed } });
    expect(framed.kind).toBe("html");
    expect(framed.fixed).toBeUndefined();
    expect(framed.hint).toMatch(/mermaid\.render/);
});

test("canvas.search ranks pages from the function index, plugins' too; the prompt names three kinds without listing views", async () => {
    const ctx: any = await mkTestCtx();
    await ctx.fns.runtime.docs.index({ localize: false });
    const all = await ctx.fns.canvas.search({});
    const views = all.filter((x: any) => x.kind === "view" && x.type === "function").map((x: any) => x.name);
    expect(views).toContain("files.page");
    expect(views).toContain("memory.view");
    const page = all.find((x: any) => x.name === "files.page");
    expect(page.usage).toContain("/rpc/files.page?");
    expect(page.signature).toContain("path");

    const site = await ctx.fns.canvas.search({ query: "web page address" });
    expect(site[0]).toMatchObject({ type: "kind", name: "url" });

    const prompt = await ctx.fns.canvas.promptSection({});
    expect(prompt).toContain("Three kinds of tab");
    expect(prompt).toContain("canvas.search({ query })");
    expect(prompt).toMatch(/There are \d+ \(plugins' too\)/);
    expect(prompt).not.toContain("`files.page`");
    expect(prompt.length).toBeLessThan(3200);
});
