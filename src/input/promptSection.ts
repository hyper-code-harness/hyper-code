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
        "To ask the person for something structured, open a form in the chat instead of asking in prose: `await ctx.fns.input.request({ kind, title, message?, spec })`, then end your turn; the answer arrives as a user turn `<input-result id kind state>`. Never ask for secrets in plain chat. Kinds: "
            + kinds.map(k => `\`${k.name}\` (${purpose(k.hint!)})`).join(", ")
            + ". Each kind's spec: `ctx.fns.input.kinds({})`.",
    ].join("\n");
}

// The part of a kind's hint before its spec: "one of several options — spec { … }" → "one of several options".
// The full spec is paid on every request of every agent; a form is opened a few times a week.
function purpose(hint: string): string {
    return hint.trim().split(/\s+—\s+spec\b/)[0]!.replace(/\s*\(.*$/, "").trim();
}
