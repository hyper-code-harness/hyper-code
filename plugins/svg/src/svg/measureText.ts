// How wide is this label, before it is on screen.
//
// SVG has no text layout: a <text> that does not fit simply runs over whatever
// is next to it, and nothing reports the collision. Every overlap in a
// hand-placed drawing comes from guessing a string's width, so guess with a
// table instead of with hope.
//
// The table is Helvetica's advance widths per 1000 units — Inter, Helvetica,
// Arial and the system sans stacks agree with it to a few percent, which is far
// closer than eyeballing. Anything outside ASCII (Cyrillic, Greek, punctuation
// dashes) falls back to 0.55em, the average of the table; CJK counts as a full
// em. This is an estimate and is documented as one: leave a little slack rather
// than butting two measured boxes together.

/** Helvetica advance widths /1000 for ASCII 32..126, in code-point order. */
const WIDTHS = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/**
 * Estimates how wide a string will be when drawn, so labels can be placed
 * without overlapping.
 *
 * Use before positioning any text whose neighbours matter: to size a box around
 * a caption, to decide whether a name fits a column, to right-align a legend.
 * Widths come from Helvetica's metrics and are accurate to a few percent for
 * Inter, Arial, Helvetica and the usual system sans stacks; `mono: true`
 * switches to the fixed 0.6em advance of ui-monospace. Non-ASCII characters are
 * approximated, CJK as a full em. Pair with svg.label to wrap a long string.
 * @param opts.text The string to measure; empty gives width 0.
 * @param opts.size Font size in pixels, the same number given to fontSize. @default 12 @minimum 1
 * @param opts.weight Font weight; 600 and up widen the estimate slightly. @default 400
 * @param opts.mono Measures as a monospaced font instead of a sans one. @default false
 * @returns Estimated width and line height in pixels, plus the em advance used.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** The string to measure; empty gives width 0. */
    text: string;
    /** Font size in pixels, the same number given to fontSize. @default 12 @minimum 1 */
    size?: number;
    /** Font weight; 600 and up widen the estimate slightly. @default 400 */
    weight?: number;
    /** Measures as a monospaced font instead of a sans one. @default false */
    mono?: boolean;
}): { width: number; height: number; em: number } {
    const text = String(opts.text ?? "");
    const size = Number(opts.size ?? 12);
    // Bold glyphs carry more ink and a wider sidebearing; 4% matches Inter.
    const bold = Number(opts.weight ?? 400) >= 600 ? 1.04 : 1;

    let em = 0;
    for (const ch of text) {
        if (opts.mono) { em += 0.6; continue; }
        const code = ch.codePointAt(0) ?? 32;
        if (code >= 32 && code <= 126) em += WIDTHS[code - 32]! / 1000;
        else if (code >= 0x2e80) em += 1;      // CJK and friends are square
        else em += 0.55;                        // Cyrillic, Greek, dashes, quotes
    }

    return { width: Math.round(em * size * bold * 100) / 100, height: Math.round(size * 1.25 * 100) / 100, em: Math.round(em * 1000) / 1000 };
}
