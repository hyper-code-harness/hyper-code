// The fact audit: compare two versions and report every meaning change.
// ctx.fns.humanizer.audit({ original, rewritten }) → { ok, changes, missing, added }

/**
 * Compares two versions of a text and reports every change in meaning, strength or commitment.
 *
 * Use after any edit that must not change what the text says: a humanizing rewrite, a
 * human editor's pass, a translation, a legal or marketing shortening. Implements the fact
 * audit of work-humanizer by Pawel Huryn and flags the specific failures it names:
 * certainty raised or lowered ("could help reduce" becoming "cuts"), a reason, condition
 * or benefit that was never stated, a changed actor, an added absolute, a vague claim made
 * vaguer, an invented specific, and any fact that disappeared. `ok` is true only when
 * nothing of substance moved.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The version whose meaning is authoritative. */
    original: string;
    /** The edited version to check against it. */
    rewritten: string;
    /** Language for the notes and verdict, such as "Russian" or "English". @default English */
    language?: string;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
}): Promise<{
    ok: boolean;
    changes: Array<{
        type: "certainty-raised" | "certainty-lowered" | "added-reason" | "added-condition" | "changed-actor" | "added-absolute" | "vaguer" | "invented-specific" | "other";
        original: string;
        rewritten: string;
        note: string;
    }>;
    missing: string[];
    added: string[];
    verdict: string;
    model: string;
}> {
    const original = opts.original?.trim();
    const rewritten = opts.rewritten?.trim();
    if (!original || !rewritten) throw new Error("humanizer.audit: both `original` and `rewritten` are required");

    const skill = await ctx.fns.humanizer.skill({ part: "skill" });
    const system = `${skill.markdown}

---

Perform ONLY the fact audit. Do not rewrite or improve anything.
Return JSON: {"changes":[{"type":"certainty-raised"|"certainty-lowered"|"added-reason"|"added-condition"|"changed-actor"|"added-absolute"|"vaguer"|"invented-specific"|"other","original":string,"rewritten":string,"note":string}],"missing":[string],"added":[string],"verdict":string}
"missing" lists facts, commitments or caveats present in the original and absent from the rewrite. "added" lists specifics in the rewrite that the original does not support. Quote the exact sentences. Style, rhythm and word choice are NOT changes in meaning: report nothing for them. Write every "note" and the "verdict" in ${opts.language ?? "English"}; quoted fragments stay in their original language. An empty changes list with empty missing and added is the correct answer for a faithful rewrite.`;

    const call = await ctx.fns.humanizer.jsonCall({
        system,
        user: `ORIGINAL:\n${original}\n\nREWRITTEN:\n${rewritten}`,
        model: opts.model,
        maxTokens: 2500,
        label: "humanizer.audit",
    });
    const parsed = call.data as { changes?: any[]; missing?: any[]; added?: any[]; verdict?: string };
    const changes = (parsed.changes ?? []).filter(c => c && (c.note || c.original)).map(c => ({
        type: c.type ?? "other",
        original: String(c.original ?? ""),
        rewritten: String(c.rewritten ?? ""),
        note: String(c.note ?? ""),
    }));
    const missing = (parsed.missing ?? []).map(String).filter(Boolean);
    const added = (parsed.added ?? []).map(String).filter(Boolean);
    const ok = changes.length === 0 && missing.length === 0 && added.length === 0;

    return {
        ok,
        changes,
        missing,
        added,
        verdict: String(parsed.verdict ?? (ok ? "no meaning change" : `${changes.length} change(s), ${missing.length} missing, ${added.length} added`)),
        model: call.model,
    };
}
