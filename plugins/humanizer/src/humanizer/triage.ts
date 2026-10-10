// Mode decision: can an edit fix this draft, or does only the writer have what is missing?
// ctx.fns.humanizer.triage({ text }) → { mode, genre, reader, placement, reason }

/**
 * Decides whether a draft can be fixed by rewriting it or needs the writer's own facts first.
 *
 * Use as the first step on any draft, to avoid rewriting a text whose problem no edit can
 * solve. Applies the mode test of work-humanizer by Pawel Huryn: could anyone with the
 * same one-line request have written this? If yes the answer is interview mode, typical
 * for posts, newsletters, bios, pitch emails and launch stories; operational text whose
 * facts are all present (a Slack update, a support answer, a release note) goes straight to
 * rewrite. Also returns the inferred genre, reader and where the point belongs, ready to
 * pass into humanizer.rewrite or humanizer.compose.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Draft to triage. */
    text: string;
    /** Language for genre, reader, missing and reason. @default the input language */
    language?: string;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
}): Promise<{
    mode: "rewrite" | "interview";
    genre: string;
    reader: string;
    placement: "answer-first" | "evidence-first";
    missing: string[];
    reason: string;
    model: string;
}> {
    const text = opts.text?.trim();
    if (!text) throw new Error("humanizer.triage: `text` is required");

    const skill = await ctx.fns.humanizer.skill({ part: "skill" });
    const system = `${skill.markdown}

---

Perform ONLY the mode decision and the read-for-the-job step. Do not rewrite, do not ask questions here.
Return JSON: {"mode":"rewrite"|"interview","genre":string,"reader":string,"placement":"answer-first"|"evidence-first","missing":[string],"reason":string}
"missing" lists what only the writer can supply (a real example, the number behind a vague word, what went wrong, what they actually think); empty when every fact is present. "reason" is one sentence. Write genre, reader, missing and reason ${opts.language ? `in ${opts.language}` : "in the language of the input text"}.`;

    const call = await ctx.fns.humanizer.jsonCall({
        system,
        user: `Draft:\n${text}`,
        model: opts.model,
        maxTokens: 900,
        label: "humanizer.triage",
    });
    const parsed = call.data as { mode?: string; genre?: string; reader?: string; placement?: string; missing?: any[]; reason?: string };

    return {
        mode: parsed.mode === "interview" ? "interview" : "rewrite",
        genre: String(parsed.genre ?? "").trim(),
        reader: String(parsed.reader ?? "").trim(),
        placement: parsed.placement === "evidence-first" ? "evidence-first" : "answer-first",
        missing: (parsed.missing ?? []).map(String).filter(Boolean),
        reason: String(parsed.reason ?? "").trim(),
        model: call.model,
    };
}
