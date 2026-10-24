// The canvas equivalent of input.promptSection: the three kinds of tab and the rule to pick one (issue #8).
/**
 * Builds the system-prompt block that tells agents how to show things on the canvas beside the chat: three kinds of tab and the rule to pick one.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    // Only the three kinds of tab and the rule to pick one; pages of Hyper (`@view` functions, plugins' too) are
    // found by canvas.search — the prompt names how many there are, never lists them, so it does not grow with
    // every mounted plugin.
    const all = (await ctx.fns.canvas.kinds({})).filter(k => k.hint);
    if (!all.length) return "";
    const has = (name: string) => all.some(k => k.name === name);
    const views = await ctx.fns.runtime.docs.search({ tag: "view", limit: 50 }).catch(() => []);
    const plugin = all.filter(k => k.module !== "canvas").map(k => k.name);
    return [
        "## Canvas",
        "",
        "A surface left of the chat for what you and the person look at together. Every tab is an **address**: it can be opened again, linked from the chat and opened in a browser tab. Open one with `await ctx.fns.canvas.show({ args, title? })` — the args decide the kind (`kind` is optional); showing the same thing again switches to its tab. The answer is the tab plus `address`, `reused`, `fixed` (what the server corrected) and `hint` (advice) — read the last two. `canvas.list({})`, `canvas.close({ itemId })`, `canvas.reopen({ itemId })` and `canvas.setState({ itemId, state })` manage tabs; a `Canvas` block tells you what is open. To open, show or look at something, use the canvas — not `ui.openFile`, which navigates the page away from the chat.",
        "",
        "Three kinds of tab. Take the first that fits:",
        "1. **Ours → a Hyper address `/rpc/<fn>?<json>`.**",
        "   - On disk (code, md, image, PDF, folder) → `{ path, host? }`. Never paste a file into html.",
        `   - Data someone will look at again → a page of a \`@view\` function: \`{ fn, params }\` or \`{ url: "/rpc/…" }\`. There are ${views.length} (plugins' too); find one with \`canvas.search({ query })\` (English) before writing html. None fits → write a \`@view\` function.`,
        "   - A document you write (analysis, plan, comparison, diagram) → `{ html }` with a stable `title`, **no scripts**: it is saved to memory as `pages/<slug>.html` and opens by address; the same title updates it. Diagrams: `mermaid.render({ source })` on the server, paste the svg.",
        "   - Only a page that must run code in the browser (an animation, a board, `hyper.setState` / `hyper.ping`) keeps `<script>`: it becomes a sandboxed frame without an address. Rare.",
        `2. **A web site → \`{ url: "https://…" }\`**, framed in the tab. Sites that forbid framing show a link unless the person's Chrome has the Hyper canvas frames extension.`,
        ...(has("browser.live") ? ["3. **A live session → `{ kind: \"browser.live\", args: { url } }`** — the Hyper machine's own Chrome, which you can drive too. Only for a login, a captcha or automation; to just look at a site use 1 or 2."] : []),
        "",
        "Bad → good: `<script src=…mermaid>` in html → `mermaid.render` (the server does it for you and says so in `fixed`) · a report written to `.hyper/tmp` and opened as a file → `{ html }`, it lands in memory · a new tab per edit → the same `title` · a file's text pasted into html → `{ path }` · `browser.live` to read a site → `{ url }`.",
        "",
        "Some functions return data AND put the same selection on a tab (`@canvas <kind>`; canvas.search finds them): call them with `canvas: true` so the person sees what you read. A `@view` function only reads and returns an html fragment; add `@live <topic>` and call `procs.events.refresh({ topic })` where the data changes, and every open copy re-fetches itself. Details: docs/canvas-views.md."
            + (plugin.length ? ` Plugin kinds: ${plugin.map(n => `\`${n}\``).join(", ")}.` : ""),
    ].join("\n");
}
