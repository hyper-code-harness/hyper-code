// Interview mode: ask the writer for what only they know, before any rewrite.
// ctx.fns.humanizer.interview({ text }) → { questions, reason, model }

/**
 * Produces up to five short questions only the writer can answer, for a draft that no edit can fix.
 *
 * Use before rewriting a post, newsletter, bio, pitch email, talk abstract, job post or
 * launch story — any text that anyone with the same one-line request could have written.
 * Runs the work-humanizer interview rules by Pawel Huryn: each question targets a gap a
 * reader would feel (the real example, the number behind "significantly", what went wrong,
 * what the writer actually thinks), asks for narration rather than form-filling, and stays
 * answerable in under a minute. Feed the answers back as `notes` to humanizer.rewrite.
 * Skip this for operational text whose facts are already present.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The draft to interrogate. */
    text: string;
    /** Maximum number of questions. @default 5 @minimum 1 @maximum 5 */
    max?: number;
    /** Language for the questions. @default the input language */
    language?: string;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
}): Promise<{
    questions: string[];
    reason: string;
    model: string;
    credit: string;
}> {
    const text = opts.text?.trim();
    if (!text) throw new Error("humanizer.interview: `text` is required");
    const max = Math.max(1, Math.min(opts.max ?? 5, 5));

    const skill = await ctx.fns.humanizer.skill({ part: "skill" });
    const system = `${skill.markdown}\n\n---\n\nOperate in INTERVIEW mode only. Do not rewrite anything. Return JSON exactly as {"reason": string, "questions": string[]} with at most ${max} questions, each quoting the line its answer would replace. Write them ${opts.language ? `in ${opts.language}` : "in the language of the input text"}. "reason" is one sentence on what the draft is missing.`;

    const call = await ctx.fns.humanizer.jsonCall({
        system,
        user: `Draft:\n${text}`,
        model: opts.model,
        maxTokens: 1200,
        label: "humanizer.interview",
    });
    const parsed = call.data as { reason?: string; questions?: string[] };
    const questions = (parsed.questions ?? []).map(q => String(q).trim()).filter(Boolean).slice(0, max);
    if (!questions.length) throw new Error("humanizer.interview: model returned no questions");

    const about = await ctx.fns.humanizer.about({});
    return {
        questions,
        reason: String(parsed.reason ?? "").trim(),
        model: call.model,
        credit: about.credit,
    };
}
