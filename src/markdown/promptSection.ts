// The fence equivalent of tools.promptSection: the system prompt advertises
// what is ACTUALLY loaded, so an unmounted plugin costs zero tokens and a
// mounted one never has to be remembered. Only fences that export a `hint` are
// listed — a fence with no hint is for a human writing a document, not for the
// model to reach for.

/**
 * Builds the system-prompt block listing Markdown fences an answer may use.
 *
 * Each mounted `$fence_<lang>.ts` that exports a `hint` contributes one line:
 * the language to write after the backticks and what it is for. A hint may be a
 * function of ctx, which returns null when the fence is switched off, so a
 * disabled fence is never advertised. Returns an empty string when nothing is
 * mounted, which keeps the prompt free of an empty heading.
 * @returns The Markdown block to splice into the system prompt, or an empty string.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<string> {
    const fences = (ctx.state as any)?.markdown?.fences as types.markdown.State["fences"];
    if (!fences) return "";

    const lines: string[] = [];
    for (const fence of Object.values(fences).sort((a, b) => a.lang.localeCompare(b.lang))) {
        if (!fence.hint) continue;
        let hint: string | null;
        try {
            hint = typeof fence.hint === "function" ? await fence.hint(ctx) : fence.hint;
        } catch (error: any) {
            // A broken hint must not cost the agent its whole system prompt.
            ctx.fns.procs.log.warn({ event: "fence.hint", msg: fence.lang, err: String(error?.message ?? error) });
            continue;
        }
        if (hint) lines.push(`- \`\`\`${fence.lang} — ${hint.trim()}`);
    }
    if (!lines.length) return "";

    return [
        "## Markdown fences",
        "",
        "These fenced block languages render as real output in your answer — write the fence directly in your reply and the user sees the picture, not the source. Everything else stays a highlighted code block. A block that fails to render degrades to code, so a broken spec is visible rather than silently missing.",
        "",
        ...lines,
        "",
        "Read the owning plugin's SKILL.md through plugins.read({ name }) for the spec language and options before writing a long one.",
    ].join("\n");
}
