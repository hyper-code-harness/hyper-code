// Sentence-length band, openers and triads — the arithmetic part of section E.
// ctx.fns.humanizer.rhythm({ text }) → { sentences, median, bandShare, verdict, ... }

/**
 * Measures sentence rhythm and reports whether a text falls into the uniform band that marks AI prose.
 *
 * Use to answer "why does this feel machine-written" when the vocabulary is already clean,
 * and to decide the direction of the fix: uniformly long means split one or two sentences,
 * uniformly short and choppy means merge them into one that breathes. Implements section E
 * of work-humanizer by Pawel Huryn: share of sentences within five words of the median
 * (over about 70% is the tell), repeated sentence openers (The, It's, That's, This, You),
 * longest and shortest sentence. Deterministic, offline, language-agnostic, no model call.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Text to measure. */
    text: string;
}): Promise<{
    sentences: number;
    median: number;
    mean: number;
    bandShare: number;
    uniform: boolean;
    direction: "split" | "merge" | "ok";
    openerShare: number;
    repeatedOpeners: Array<{ word: string; count: number }>;
    longest: { words: number; text: string } | null;
    shortest: { words: number; text: string } | null;
    verdict: string;
}> {
    const text = opts.text;
    if (!text?.trim()) throw new Error("humanizer.rhythm: `text` is required");

    const parts = text.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2);
    const lens = parts.map(s => s.split(/\s+/).length);
    if (lens.length < 2) {
        return {
            sentences: lens.length, median: lens[0] ?? 0, mean: lens[0] ?? 0, bandShare: 1, uniform: false,
            direction: "ok", openerShare: 0, repeatedOpeners: [], longest: null, shortest: null,
            verdict: "too short to measure rhythm",
        };
    }

    const sorted = [...lens].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const bandShare = lens.filter(x => Math.abs(x - median) <= 5).length / lens.length;
    const uniform = bandShare >= 0.7;
    const direction: "split" | "merge" | "ok" = !uniform ? "ok" : mean < 11 ? "merge" : "split";

    const openerSet = new Set(["the", "it's", "it’s", "that's", "that’s", "this", "you", "it", "these", "we", "our"]);
    const starts = parts.map(s => (s.split(/\s+/)[0] ?? "").toLowerCase().replace(/^["'“«]/, "").replace(/[,.:;]$/, ""));
    const openerShare = starts.filter(s => openerSet.has(s)).length / starts.length;
    const counts: Record<string, number> = {};
    for (const s of starts) counts[s] = (counts[s] ?? 0) + 1;
    const repeatedOpeners = Object.entries(counts).filter(([, c]) => c >= 2)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([word, count]) => ({ word, count }));

    const iMax = lens.indexOf(Math.max(...lens));
    const iMin = lens.indexOf(Math.min(...lens));
    const clip = (s: string) => s.length > 120 ? s.slice(0, 120) + "…" : s;

    const verdict = uniform
        ? `${Math.round(bandShare * 100)}% of sentences sit within 5 words of the median (${median}); ${direction === "merge" ? "short and choppy, merge into longer sentences that breathe" : "uniformly long, split one or two and add a short sentence that lands a fact"}`
        : `varied: ${Math.round(bandShare * 100)}% within 5 words of the median (${median})`;

    return {
        sentences: lens.length,
        median,
        mean: Number(mean.toFixed(1)),
        bandShare: Number(bandShare.toFixed(2)),
        uniform,
        direction,
        openerShare: Number(openerShare.toFixed(2)),
        repeatedOpeners,
        longest: { words: lens[iMax] ?? 0, text: clip(parts[iMax] ?? "") },
        shortest: { words: lens[iMin] ?? 0, text: clip(parts[iMin] ?? "") },
        verdict,
    };
}
