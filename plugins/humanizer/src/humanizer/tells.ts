// Locate upstream tell-list hits in a text, with offsets and category.
// ctx.fns.humanizer.tells({ text }) → { hits, byCategory, total }
import { resolve } from "node:path";

/**
 * Finds every stock AI phrase from the upstream tell lists in a text and reports where each one sits.
 *
 * Use to show the user exactly which words give a draft away, to highlight them in an
 * editor, or to decide whether a passage is worth rewriting: one hit is weak evidence,
 * several in one passage are the tell. Categories follow tells.md by Pawel Huryn: stock AI
 * vocabulary, marketing register, filler transitions, pause-and-point lines, restating
 * closers, filler hedges, op-ed attribution verbs and chat residue. Deterministic,
 * offline, no model call; vocabulary is English, so a zero result on a non-Latin text means
 * nothing and is reported through `englishText: false` and `note`. For counts plus rhythm use humanizer.check.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Text to scan. */
    text: string;
    /** Return only hits in these categories. */
    categories?: Array<"ai-vocabulary" | "marketing" | "transitions" | "pause-and-point" | "closers" | "hedges" | "attribution" | "chat-residue">;
}): Promise<{
    hits: Array<{ phrase: string; category: string; offset: number; line: number; context: string }>;
    byCategory: Record<string, number>;
    total: number;
    englishText: boolean;
    note: string | null;
    source: string;
}> {
    const text = opts.text;
    if (!text?.trim()) throw new Error("humanizer.tells: `text` is required");

    const abs = resolve(import.meta.dir, "../../vendor/work-humanizer/tells.md");
    const md = await Bun.file(abs).text();

    const sectionCategory: Array<[RegExp, string]> = [
        [/^## Stock AI vocabulary/i, "ai-vocabulary"],
        [/^## Marketing register/i, "marketing"],
        [/^## Filler transitions/i, "transitions"],
        [/^## Pause-and-point/i, "pause-and-point"],
        [/^## Restating and engagement closers/i, "closers"],
        [/^## Filler hedges/i, "hedges"],
        [/^## Op-ed attribution verbs/i, "attribution"],
        [/^## Chat residue/i, "chat-residue"],
    ];

    // Collect phrases per section: comma- or slash-separated inventories, parentheticals dropped.
    const terms: Array<{ phrase: string; category: string }> = [];
    let current: string | null = null;
    for (const rawLine of md.split("\n")) {
        const head = sectionCategory.find(([re]) => re.test(rawLine));
        if (rawLine.startsWith("## ")) { current = head ? head[1] : null; continue; }
        if (!current || !rawLine.trim() || rawLine.startsWith("|") || rawLine.startsWith("#")) continue;
        if (/^(Built the conservative|Lists are for)/i.test(rawLine)) continue;
        const body = rawLine.replace(/^Phrases:\s*/i, "").replace(/\*\*/g, "");
        for (const piece of body.split(/[,/]| \| /)) {
            const phrase = piece
                .replace(/\([^)]*\)/g, "")
                .replace(/\.\.\.$/, "")
                .replace(/^\s*[-–]\s*/, "")
                .trim()
                .replace(/\.$/, "");
            if (phrase.length < 3 || phrase.length > 60) continue;
            if (/^(Use|A hit|TL;DR at the end)/i.test(phrase)) continue;
            terms.push({ phrase, category: current });
        }
    }

    const wanted = opts.categories?.length ? new Set(opts.categories as string[]) : null;
    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
    const lineOf = (off: number) => lineStarts.filter(s => s <= off).length;

    const hits: Array<{ phrase: string; category: string; offset: number; line: number; context: string }> = [];
    const seen = new Set<string>();
    for (const { phrase, category } of terms) {
        if (wanted && !wanted.has(category)) continue;
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]");
        const boundary = /^[\w]/.test(phrase) ? "\\b" : "";
        const re = new RegExp(`${boundary}${escaped}`, "gi");
        for (const m of text.matchAll(re)) {
            const offset = m.index ?? 0;
            const key = `${offset}:${m[0].toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            hits.push({
                phrase: m[0],
                category,
                offset,
                line: lineOf(offset),
                context: text.slice(Math.max(0, offset - 30), offset + m[0].length + 30).replace(/\s+/g, " ").trim(),
            });
        }
    }
    hits.sort((a, b) => a.offset - b.offset || b.phrase.length - a.phrase.length);

    // One hit per position: "seamlessly" and "seamless" start at the same offset, keep the longer.
    const deduped: typeof hits = [];
    for (const h of hits) {
        const covered = deduped.some(k => h.offset >= k.offset && h.offset + h.phrase.length <= k.offset + k.phrase.length);
        if (!covered) deduped.push(h);
    }

    const byCategory: Record<string, number> = {};
    for (const h of deduped) byCategory[h.category] = (byCategory[h.category] ?? 0) + 1;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length / Math.max(1, text.replace(/\s/g, "").length);
    return {
        hits: deduped,
        byCategory,
        total: deduped.length,
        englishText: latin >= 0.5,
        note: latin >= 0.5 ? null : "The tell lists are English; this text is mostly non-Latin, so a zero result says nothing about it. Use humanizer.rhythm and the LLM steps instead.",
        source: "tells.md (work-humanizer by Pawel Huryn, MIT)",
    };
}
