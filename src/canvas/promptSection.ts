// The canvas equivalent of input.promptSection: the three kinds of tab and the rule to pick one (issue #8).
/**
 * Builds the system-prompt block that tells agents how to show things on the canvas beside the chat: three kinds of tab and the rule to pick one.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    // Only the three kinds of tab and the rule to pick one; pages of Hyper (`@view` functions, plugins' too) are
    // found by canvas.search — the prompt names how many there are, never lists them, so it does not grow with
    // every mounted plugin. Everything else (tab management, @live, the bad → good list) is in docs/canvas-views.md:
    // it is paid on every request of every agent, and most turns never open a tab.
    const all = (await ctx.fns.canvas.kinds({})).filter(k => k.hint);
    if (!all.length) return "";
    const has = (name: string) => all.some(k => k.name === name);
    const views = await ctx.fns.runtime.docs.search({ tag: "view", limit: 50 }).catch(() => []);
    return [
        "## Canvas",
        "",
        "A tab surface beside the chat; every tab is an address. `await ctx.fns.canvas.show({ args, title? })` — args decide the kind; the same args or title reuse the tab; read `fixed` and `hint` in the answer. Use it, not `ui.openFile`. Three kinds of tab — take the first that fits:",
        `1. **Hyper address.** A file on disk → \`{ path, host? }\` (never paste a file into html). Data seen again → a \`@view\` page \`{ fn, params }\`: there are ${views.length}, find one with \`canvas.search({ query })\`. A document you write → \`{ html }\` with a stable \`title\`, no scripts (diagrams: \`mermaid.render\` on the server).`,
        `2. **A web site** → \`{ url: "https://…" }\`.`,
        ...(has("browser.live") ? ["3. **A live browser** → `{ kind: \"browser.live\", args: { url } }` — only for a login, captcha or automation."] : []),
        "",
        "Tab management, `@live` views and `canvas: true` functions: docs/canvas-views.md.",
    ].join("\n");
}
