// The input equivalent of markdown.promptSection: the system prompt lists the
// kinds that are actually loaded, so a plugin's kind is advertised exactly while
// it is mounted.
/**
 * Builds the system-prompt block that tells agents how to ask the person through chat inputs and lists the loaded kinds.
 */
export default function (ctx: Context, _session: Session | null, _opts: {}): string {
    const kinds = ctx.fns.input.kinds({}).filter(k => k.hint);
    if (!kinds.length) return "";
    return [
        "## Chat inputs",
        "",
        "To ask the person for something structured — a secret, a yes/no on an outward action, one of several options, a pick from a table — open a form in the chat instead of asking in prose: `await ctx.fns.input.request({ kind, title, message?, spec })`. It returns at once with the input id; end your turn. The answer arrives later as a user turn `<input-result id kind state>` with a one-line summary and JSON result (state `cancelled` when the person declined). Never ask for secrets in plain chat.",
        "",
        ...kinds.map(k => `- \`${k.name}\` — ${k.hint!.trim()}`),
    ].join("\n");
}
