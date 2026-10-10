// Step 2 of the skill: the fact register that must survive any rewrite.
// ctx.fns.humanizer.facts({ text }) → { facts, counts }

/**
 * Extracts every fact, number, name, date, commitment and caveat from a text with its level of certainty.
 *
 * Use before rewriting, translating or shortening anything whose wording carries
 * obligations, and as the baseline for humanizer.audit afterwards. Implements step 2 of
 * work-humanizer by Pawel Huryn: each item keeps the qualifier attached to it ("could",
 * "typically", "about", "the remaining piece"), because a rewrite may change the words but
 * not the strength. Nothing is invented and nothing is summarized away; the list is meant
 * to survive intact. Use humanizer.compose to write a new piece from it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Text to inventory. */
    text: string;
    /** Language for the extracted claims, when it should differ from the input. @default the input language */
    language?: string;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
}): Promise<{
    facts: Array<{
        claim: string;
        kind: "number" | "name" | "date" | "claim" | "commitment" | "caveat" | "link" | "call-to-action";
        certainty: "stated-flatly" | "qualified" | "opinion" | "vague";
        qualifier: string | null;
    }>;
    counts: Record<string, number>;
    model: string;
}> {
    const text = opts.text?.trim();
    if (!text) throw new Error("humanizer.facts: `text` is required");

    const skill = await ctx.fns.humanizer.skill({ part: "skill" });
    const system = `${skill.markdown}

---

Perform ONLY step 2 of rewrite mode: list the facts with their certainty. Do not rewrite anything, do not comment.
Return JSON: {"facts":[{"claim":string,"kind":"number"|"name"|"date"|"claim"|"commitment"|"caveat"|"link"|"call-to-action","certainty":"stated-flatly"|"qualified"|"opinion"|"vague","qualifier":string|null}]}
Keep each claim ${opts.language ? `in ${opts.language}` : "in the language of the input"} and as close to its original wording as possible. "qualifier" is the hedge or scope word the writer chose, verbatim, or null. Invent nothing.`;

    const call = await ctx.fns.humanizer.jsonCall({
        system,
        user: `Text:\n${text}`,
        model: opts.model,
        maxTokens: 2500,
        label: "humanizer.facts",
    });
    const parsed = call.data as { facts?: any[] };
    const facts = (parsed.facts ?? []).filter(f => f && typeof f.claim === "string" && f.claim.trim()).map(f => ({
        claim: String(f.claim).trim(),
        kind: f.kind ?? "claim",
        certainty: f.certainty ?? "stated-flatly",
        qualifier: f.qualifier ? String(f.qualifier) : null,
    }));
    const counts: Record<string, number> = {};
    for (const f of facts) counts[f.kind] = (counts[f.kind] ?? 0) + 1;

    return { facts, counts, model: call.model };
}
