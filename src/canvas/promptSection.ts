// The canvas equivalent of input.promptSection: the system prompt lists the kinds that are actually
// loaded, so a plugin's kind is advertised exactly while it is mounted.
/**
 * Builds the system-prompt block that tells agents how to show things on the canvas beside the chat and lists the loaded kinds.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    const kinds = (await ctx.fns.canvas.kinds({})).filter(k => k.hint);
    if (!kinds.length) return "";
    return [
        "## Canvas",
        "",
        "A large surface left of the chat where you can put something in front of the person — a file to look at together, a document, a diagram. Open a tab with `await ctx.fns.canvas.show({ kind, args, title? })`; it becomes the active tab and the canvas opens. `canvas.list({})` shows the tabs, `canvas.close({ itemId })` closes one (it is only marked closed: `canvas.list({ closed: true })` lists recently closed tabs with their `closedAt`, `canvas.reopen({ itemId })` brings one back with its state; kept 30 days), `canvas.setState({ itemId, state })` remembers a tab's own state. When the canvas changes you get a short `Canvas` block saying what is open.",
        "",
        "When the person asks to open, show or look at a file, a README, a document or a picture, put it on the canvas — not `ui.openFile`, which navigates the whole page away from the chat. Only the canvas region refreshes; the chat, drafts and scroll stay. Showing the same thing again just switches to its tab. Relative paths resolve in your workspace; for another project pass an absolute path.",
        "",
        ...kinds.map(k => `- \`${k.name}\` — ${k.hint!.trim()}`),
    ].join("\n");
}
