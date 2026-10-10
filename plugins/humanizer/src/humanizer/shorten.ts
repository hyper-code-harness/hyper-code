// Final check 7: cut candidates with word counts, offered and never applied.
// ctx.fns.humanizer.shorten({ text }) → { offer, candidates, totalWords, shorterText? }

/**
 * Lists the parts of a text that could be cut without losing a fact, with word counts, and offers a shorter version.
 *
 * Use on a finished piece over about 100 words, when the question is "can this be
 * tighter" and the answer must be auditable. Implements final check 7 of work-humanizer by
 * Pawel Huryn: each candidate is a paragraph whose removal costs the reader no fact,
 * commitment, decision or point — a general opening, a line any similar piece would have,
 * a near-duplicate, a second argument that could stand alone. Proof and stakes (examples,
 * numbers, commitments, disclosures) are never offered for cutting. The cut is an offer:
 * pass `write: true` to also receive the shortened text, otherwise only the candidates.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Finished text to review. */
    text: string;
    /** Also return the shortened version in full, applying the candidates. @default false */
    write?: boolean;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
}): Promise<{
    offer: boolean;
    candidates: Array<{ excerpt: string; words: number; why: string }>;
    cuttableWords: number;
    totalWords: number;
    share: number;
    line: string;
    shorterText: string | null;
    model: string;
}> {
    const text = opts.text?.trim();
    if (!text) throw new Error("humanizer.shorten: `text` is required");
    const totalWords = text.split(/\s+/).filter(Boolean).length;

    const skill = await ctx.fns.humanizer.skill({ part: "skill" });
    const system = `${skill.markdown}

---

Perform ONLY final check 7, the shorter option. Do not humanize or restyle anything.
Return JSON: {"candidates":[{"excerpt":string,"words":number,"why":string}],"line":string${opts.write ? ',"shorterText":string' : ""}}
"excerpt" quotes the start of the cut candidate verbatim. Count words, do not guess. Never offer to cut the proof or the stakes: examples, numbers, commitments, or a disclosure that makes the reader trust the piece. "line" is the single line that starts with "Shorter option:" — it MUST agree with your own candidates: when they add up to about a quarter of the text or more, offer the cut; when they add up to less, or there are none, the line is exactly "Shorter option: none, it's already tight." and the candidates list must be empty. Write it in the language of the input text.${opts.write ? ' "shorterText" is the full text with the candidates removed and nothing else changed.' : ""}`;

    const call = await ctx.fns.humanizer.jsonCall({
        system,
        user: `Text (${totalWords} words):\n${text}`,
        model: opts.model,
        maxTokens: opts.write ? 3000 : 1200,
        label: "humanizer.shorten",
    });
    const parsed = call.data as { candidates?: any[]; line?: string; shorterText?: string };

    const candidates = (parsed.candidates ?? []).filter(c => c && c.excerpt).map(c => ({
        excerpt: String(c.excerpt).trim(),
        words: Number(c.words) || String(c.excerpt).split(/\s+/).length,
        why: String(c.why ?? "").trim(),
    }));
    const cuttableWords = candidates.reduce((a, c) => a + c.words, 0);
    const share = totalWords ? cuttableWords / totalWords : 0;
    const offer = share >= 0.25 && candidates.length > 0;
    // Keep the offered line consistent with our own arithmetic, whatever the model wrote.
    const modelLine = String(parsed.line ?? "").trim();
    const line = offer
        ? (/^Shorter option:\s*none/i.test(modelLine) || !modelLine ? `Shorter option: cut ${candidates.length} passage(s), about ${cuttableWords} of ${totalWords} words.` : modelLine)
        : "Shorter option: none, it's already tight.";

    return {
        offer,
        candidates: offer ? candidates : [],
        cuttableWords,
        totalWords,
        share: Number(share.toFixed(2)),
        line,
        shorterText: opts.write && offer && parsed.shorterText ? String(parsed.shorterText).trim() : null,
        model: call.model,
    };
}
