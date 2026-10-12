// The canvas equivalent of input.promptSection: the system prompt lists the kinds that are actually
// loaded, so a plugin's kind is advertised exactly while it is mounted.
/**
 * Builds the system-prompt block that tells agents how to show things on the canvas beside the chat and lists the loaded kinds.
 */
export default function (ctx: Context, _session: Session | null, _opts: {}): string {
    const kinds = ctx.fns.canvas.kinds({}).filter(k => k.hint);
    if (!kinds.length) return "";
    return [
        "## Canvas",
        "",
        "A large surface left of the chat where you can put something in front of the person — a file to look at together, a document, a diagram. Open a tab with `await ctx.fns.canvas.show({ kind, args, title? })`; it becomes the active tab and the canvas opens. `canvas.list({})` shows the tabs, `canvas.close({ itemId })` closes one, `canvas.setState({ itemId, state })` remembers a tab's own state. When the canvas changes you get a short `Canvas` block saying what is open.",
        "",
        ...kinds.map(k => `- \`${k.name}\` — ${k.hint!.trim()}`),
    ].join("\n");
}
