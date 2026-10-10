// Rewrite mode as a pipeline: triage → facts → compose → audit → check → shorten.
// ctx.fns.humanizer.rewrite({ text }) → { text, audit, checked, trace }

/**
 * Rewrites AI-sounding text in a plain human voice and verifies that no fact or commitment changed.
 *
 * Use for work writing where the wording carries obligations: emails, sales and marketing
 * copy, support replies, HR and legal letters, release notes, docs, posts, landing pages.
 * Runs the work-humanizer steps by Pawel Huryn as separate verifiable stages — triage,
 * fact register, fresh composition, fact audit, mechanical sweep, shorter option — and
 * returns the trace, so a bad result shows which stage produced it. Pass `notes` (your own
 * bullets or a voice-memo transcript) to make your material the skeleton. When triage says
 * the draft needs the writer's own facts, `interviewNeeded` is set and the questions come
 * back instead of a rewrite unless `force` is true. This does not defeat AI detectors.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The text to rewrite. */
    text: string;
    /** The writer's own notes, bullets or voice-memo transcript; becomes the primary material. */
    notes?: string;
    /** Genre hint, such as "cold sales email"; inferred by triage when omitted. */
    genre?: string;
    /** Intended reader; inferred by triage when omitted. */
    reader?: string;
    /** Rewrite even when triage says the draft needs an interview first. @default false */
    force?: boolean;
    /** Skip the LLM fact audit of the result. @default false */
    skipAudit?: boolean;
    /** Also list cut candidates for the result. @default true */
    shorter?: boolean;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
}): Promise<{
    text: string | null;
    faithful: boolean | null;
    warnings: string[];
    interviewNeeded: boolean;
    questions: string[];
    audit: { ok: boolean; verdict: string; changes: number; missing: number; added: number } | null;
    checked: string[];
    rhythm: string;
    shorterOption: string | null;
    trace: Array<{ step: string; ms: number; detail: string }>;
    credit: string;
}> {
    const text = opts.text?.trim();
    if (!text) throw new Error("humanizer.rewrite: `text` is required");

    const trace: Array<{ step: string; ms: number; detail: string }> = [];
    const step = async <T>(name: string, fn: () => Promise<T>, detail: (r: T) => string): Promise<T> => {
        const t0 = Date.now();
        const r = await fn();
        trace.push({ step: name, ms: Date.now() - t0, detail: detail(r) });
        return r;
    };

    const credit = (await ctx.fns.humanizer.about({})).credit;

    const triage = await step("triage",
        () => ctx.fns.humanizer.triage({ text, model: opts.model }),
        r => `${r.mode}: ${r.reason}`);

    if (triage.mode === "interview" && !opts.notes?.trim() && !opts.force) {
        const iv = await step("interview",
            () => ctx.fns.humanizer.interview({ text, model: opts.model }),
            r => `${r.questions.length} question(s)`);
        return {
            text: null, faithful: null, warnings: [], interviewNeeded: true, questions: iv.questions, audit: null,
            checked: [], rhythm: "", shorterOption: null, trace, credit,
        };
    }

    const facts = await step("facts",
        () => ctx.fns.humanizer.facts({ text, model: opts.model }),
        r => `${r.facts.length} fact(s)`);

    const composed = await step("compose",
        () => ctx.fns.humanizer.compose({
            facts: facts.facts,
            notes: opts.notes,
            checklist: opts.notes?.trim() ? text : undefined,
            genre: opts.genre ?? triage.genre,
            reader: opts.reader ?? triage.reader,
            placement: triage.placement,
            model: opts.model,
        }),
        r => `${r.words} words`);

    const audit = opts.skipAudit ? null : await step("audit",
        () => ctx.fns.humanizer.audit({ original: opts.notes?.trim() ? `${opts.notes}\n\n${text}` : text, rewritten: composed.text, model: opts.model }),
        r => r.verdict);

    const sweep = await step("check",
        () => ctx.fns.humanizer.check({ text: composed.text }),
        r => `${r.findings.length} finding(s)`);

    const rhythm = await step("rhythm",
        () => ctx.fns.humanizer.rhythm({ text: composed.text }),
        r => r.verdict);

    const shorter = opts.shorter === false || composed.words < 100 ? null : await step("shorten",
        () => ctx.fns.humanizer.shorten({ text: composed.text, model: opts.model }),
        r => r.line || `${r.candidates.length} candidate(s)`);

    const warnings: string[] = [];
    if (audit && !audit.ok) {
        for (const c of audit.changes) warnings.push(`${c.type}: ${c.note || c.rewritten}`.slice(0, 300));
        for (const m of audit.missing) warnings.push(`missing: ${m}`.slice(0, 300));
        for (const a of audit.added) warnings.push(`added: ${a}`.slice(0, 300));
    }

    return {
        text: composed.text,
        faithful: audit ? audit.ok : null,
        warnings,
        interviewNeeded: false,
        questions: [],
        audit: audit ? { ok: audit.ok, verdict: audit.verdict, changes: audit.changes.length, missing: audit.missing.length, added: audit.added.length } : null,
        checked: sweep.findings,
        rhythm: rhythm.verdict,
        shorterOption: shorter?.line ?? null,
        trace,
        credit,
    };
}
