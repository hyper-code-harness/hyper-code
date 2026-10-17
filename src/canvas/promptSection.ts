// The canvas equivalent of input.promptSection: the system prompt lists the kinds that are actually
// loaded, so a plugin's kind is advertised exactly while it is mounted.
/**
 * Builds the system-prompt block that tells agents how to show things on the canvas beside the chat and lists the loaded kinds.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    // Built-in kinds are described in full; plugin kinds and the functions that show their result on the
    // canvas are only named — canvas.search finds them with their args, so the prompt does not grow
    // with every mounted plugin.
    const all = (await ctx.fns.canvas.kinds({})).filter(k => k.hint);
    if (!all.length) return "";
    const kinds = all.filter(k => k.module === "canvas");
    const plugin = all.filter(k => k.module !== "canvas").map(k => k.name);
    const found = (await ctx.fns.canvas.search({ limit: 100 })).filter(r => r.type === "function");
    const shows = found.filter(r => r.kind !== "view").map(r => r.name);
    const views = found.filter(r => r.kind === "view").map(r => r.name);
    return [
        "## Canvas",
        "",
        "A large surface left of the chat where you can put something in front of the person — a file to look at together, a document, a diagram. Open a tab with `await ctx.fns.canvas.show({ kind, args, title? })`; it becomes the active tab and the canvas opens. `canvas.list({})` shows the tabs, `canvas.close({ itemId })` closes one (it is only marked closed: `canvas.list({ closed: true })` lists recently closed tabs with their `closedAt`, `canvas.reopen({ itemId })` brings one back with its state; kept 30 days), `canvas.setState({ itemId, state })` remembers a tab's own state. When the canvas changes you get a short `Canvas` block saying what is open.",
        "",
        "When the person asks to open, show or look at a file, a README, a document or a picture, put it on the canvas — not `ui.openFile`, which navigates the whole page away from the chat. Only the canvas region refreshes; the chat, drafts and scroll stay. Showing the same thing again just switches to its tab. Relative paths resolve in your workspace; for another project pass an absolute path.",
        "",
        ...kinds.map(k => `- \`${k.name}\` — ${k.hint!.trim()}`),
        ...(plugin.length ? [`- plugin kinds: ${plugin.map(n => `\`${n}\``).join(", ")} — their args via \`canvas.search({ query })\``] : []),
        "",
        "Some functions return data AND can show the same selection on the canvas (`@canvas <kind>` in their docs; `canvas.search({ query })` finds them). When you answer from such data, call them with `canvas: true` so the person sees exactly what you read; they reuse the tab and return its `itemId`. What the person then changes in that tab (filter, opened record) arrives in the Canvas block — repeat the call without `canvas` to read the same data."
            + (shows.length ? ` Loaded: ${shows.map(n => `\`${n}\``).join(", ")}.` : ""),
        "",
        "A page you or the person will open again belongs at an address: a function tagged `@view` in its JSDoc (it only reads, returns html or rows) opens at `/rpc/<fn>?<json>` — on the canvas as a `view` tab, in a chat link, in a browser tab — and links inside move the same tab. Write one instead of a one-off html tab when the content comes from data. It returns an html fragment (no scripts; an app that needs its own scripts returns `rpc.frame({ src })`); add `@live <topic>` and call `procs.events.refresh({ topic })` where the data changes, and every open copy re-fetches itself (memory pages are `@live memory`)."
            + (views.length ? ` Views: ${views.map(n => `\`${n}\``).join(", ")}.` : ""),
    ].join("\n");
}
