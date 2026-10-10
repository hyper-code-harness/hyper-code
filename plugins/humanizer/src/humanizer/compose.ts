// Step 3 of the skill: write the piece fresh from the fact register and the writer's words.
// ctx.fns.humanizer.compose({ facts, notes }) → { text, model }

/**
 * Writes a piece fresh from a fact register and the writer's own words, without copying the AI draft's sentences.
 *
 * Use after humanizer.facts or humanizer.interview, when the point is to compose rather
 * than patch: a patched AI draft still reads like one, because the draft's sentence
 * skeletons carry its signature. Implements step 3 of work-humanizer by Pawel Huryn — the
 * writer's notes and interview answers are the skeleton and their phrasing is kept, the
 * fact register fixes what must appear and at which strength, and no specific outside them
 * may be invented. Pass the AI draft only as `checklist`, never as the shape.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Fact register from humanizer.facts; every item must appear at the same strength. */
    facts?: Array<{ claim: string; kind?: string; certainty?: string; qualifier?: string | null }>;
    /** The writer's own notes, bullets or voice-memo transcript; their claims and order become the skeleton. */
    notes?: string;
    /** Answers to humanizer.interview questions, as question/answer pairs or free text. */
    answers?: string;
    /** The AI draft, used strictly as a checklist of points. */
    checklist?: string;
    /** Genre such as "release notes" or "cold sales email". */
    genre?: string;
    /** Intended reader. */
    reader?: string;
    /** Where the point goes. @default answer-first */
    placement?: "answer-first" | "evidence-first";
    /** Target language of the output, when it should differ from the input material. */
    language?: string;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
    /** Maximum output tokens. @default 3000 @minimum 500 @maximum 16000 */
    maxTokens?: number;
}): Promise<{
    text: string;
    chars: number;
    words: number;
    model: string;
}> {
    const material = [opts.notes?.trim(), opts.answers?.trim(), opts.facts?.length ? "facts" : null].filter(Boolean);
    if (!material.length) throw new Error("humanizer.compose: pass at least one of `notes`, `answers` or `facts`");

    const skill = await ctx.fns.humanizer.skill({ part: "skill" });
    const tells = await ctx.fns.humanizer.skill({ part: "tells" });
    const system = `${skill.markdown}

---

${tells.markdown}

---

Perform ONLY step 3 onward: write the piece fresh. The writer's notes and answers are the material and their sentences stay whole where possible. Any text given as a checklist may contribute points, never its skeleton, transitions or framing. Return the finished text and nothing else: no preamble, no notes, no "Shorter option" line.${opts.language ? ` Write in ${opts.language}.` : " Write in the language of the writer's material."}`;

    const parts = [
        opts.genre ? `Genre: ${opts.genre}` : null,
        opts.reader ? `Reader: ${opts.reader}` : null,
        `Placement: ${opts.placement ?? "answer-first"}`,
        opts.facts?.length
            ? `Fact register (each must appear, at this strength):\n${opts.facts.map(f => `- ${f.claim}${f.qualifier ? ` [qualifier: ${f.qualifier}]` : ""}${f.certainty ? ` (${f.certainty})` : ""}`).join("\n")}`
            : null,
        opts.notes?.trim() ? `The writer's notes (skeleton; keep their phrasing and order):\n${opts.notes.trim()}` : null,
        opts.answers?.trim() ? `The writer's answers to the interview questions:\n${opts.answers.trim()}` : null,
        opts.checklist?.trim() ? `AI draft — checklist of points only, never the shape:\n${opts.checklist.trim()}` : null,
    ].filter(Boolean);

    const res = await ctx.fns.llm.call({
        user: parts.join("\n\n"),
        system,
        model: opts.model,
        max_tokens: opts.maxTokens ?? 3000,
    });
    const text = (res.text ?? "").trim();
    if (!text) throw new Error("humanizer.compose: model returned no text");

    return {
        text,
        chars: text.length,
        words: text.split(/\s+/).filter(Boolean).length,
        model: res.model ?? opts.model ?? "default",
    };
}
