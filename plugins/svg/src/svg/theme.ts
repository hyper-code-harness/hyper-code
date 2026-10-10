// Thirty-five hex codes in one drawing, and three of them differ by a digit.
//
// Counting my own drafts: 25 to 35 distinct hex literals per picture, where the
// real palette is three greys and two accents. Every fence reinvented the same
// shades, and no two drawings matched. `<style>` is stripped (an inline SVG is
// part of the page DOM and its CSS would leak into the chat), so the fix cannot
// be a stylesheet — it has to be values, handed out by role.
//
// The shape is Rough.js's cascade: library defaults, overridden per theme,
// overridden per call. A tone is the set a shape actually needs — fill, stroke
// and the text colour that stays readable on it — because picking those three
// separately is how a drawing ends up with grey text on a grey card.

/** A shape's three colours, which are always chosen together. */
type Tone = { fill: string; stroke: string; text: string };

/** The named palettes. "paper" is the default: quiet, light, print-like. */
const THEMES: Record<string, { tones: Record<string, Tone>; ink: string; note: string; faint: string; line: string; bg: string }> = {
    paper: {
        ink: "#2f3540", note: "#8b94a3", faint: "#c2c8d2", line: "#E6EAF0", bg: "#F7F9FC",
        tones: {
            neutral: { fill: "#F5F6F8", stroke: "#E6EAF0", text: "#2f3540" },
            accent: { fill: "#EEF3FC", stroke: "#DBE5F7", text: "#2f3540" },
            solid: { fill: "#9DB4E0", stroke: "#8AA3D4", text: "#ffffff" },
            good: { fill: "#EDF5EE", stroke: "#D4E6D7", text: "#2f3540" },
            warn: { fill: "#FBF3E7", stroke: "#F0E0C6", text: "#2f3540" },
            bad: { fill: "#FBEDED", stroke: "#F0D4D4", text: "#2f3540" },
            muted: { fill: "#FAFBFD", stroke: "#EFF2F6", text: "#8b94a3" },
        },
    },
    slate: {
        ink: "#E8ECF2", note: "#9AA4B2", faint: "#6B7483", line: "#39414F", bg: "#242A33",
        tones: {
            neutral: { fill: "#2E3540", stroke: "#39414F", text: "#E8ECF2" },
            accent: { fill: "#2C3A52", stroke: "#3C4E6B", text: "#E8ECF2" },
            solid: { fill: "#7D9BD0", stroke: "#6B88BC", text: "#1B2027" },
            good: { fill: "#2A3A32", stroke: "#38503F", text: "#E8ECF2" },
            warn: { fill: "#3D362A", stroke: "#564A36", text: "#E8ECF2" },
            bad: { fill: "#3D2C2C", stroke: "#573B3B", text: "#E8ECF2" },
            muted: { fill: "#282E38", stroke: "#333B46", text: "#9AA4B2" },
        },
    },
    warm: {
        ink: "#3B332C", note: "#95897C", faint: "#C6BCB0", line: "#EBE3D9", bg: "#FAF7F2",
        tones: {
            neutral: { fill: "#F5F1EA", stroke: "#EBE3D9", text: "#3B332C" },
            accent: { fill: "#F6EDE2", stroke: "#E8D8C4", text: "#3B332C" },
            solid: { fill: "#C9A77C", stroke: "#B9966A", text: "#ffffff" },
            good: { fill: "#EFF2E6", stroke: "#DCE3C9", text: "#3B332C" },
            warn: { fill: "#FAF0DC", stroke: "#EEDDB8", text: "#3B332C" },
            bad: { fill: "#F7E8E3", stroke: "#EBD0C6", text: "#3B332C" },
            muted: { fill: "#FBF9F5", stroke: "#F1ECE4", text: "#95889C" },
        },
    },
};

/** The 8-point scale, with a half step for the gaps inside a control. */
const UNIT = 8;

/**
 * Gives a drawing one palette and one spacing scale, addressed by role.
 *
 * Use at the top of every drawing instead of writing hex codes: `t.tone("accent")`
 * returns the fill, stroke and readable text colour together, which is what a
 * card or a node actually needs, and `t.ink`/`t.note`/`t.faint` are the three
 * text weights a diagram uses. `t.space(2)` is the 8-point scale (16px), so
 * gaps and padding come from one sequence rather than from taste. Pass
 * `tones` or `colors` to override any single value without restating the rest.
 * Because `<style>` is stripped from inline SVG, these are plain values meant
 * to be spread onto elements — `<rect {...box} {...t.tone("accent")}/>` works
 * because a tone's keys are already fill and stroke.
 * @param opts.name Which palette: paper (light), slate (dark), warm. @default "paper"
 * @param opts.tones Per-tone overrides, merged over the palette.
 * @param opts.colors Overrides for ink, note, faint, line or bg.
 * @param opts.unit Base spacing unit in pixels. @default 8 @minimum 1
 * @returns The palette's text colours, a tone lookup, a spacing scale and the tone names.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Which palette: paper (light), slate (dark), warm. @default "paper" */
    name?: "paper" | "slate" | "warm";
    /** Per-tone overrides, merged over the palette. */
    tones?: Record<string, Partial<Tone>>;
    /** Overrides for ink, note, faint, line or bg. */
    colors?: { ink?: string; note?: string; faint?: string; line?: string; bg?: string };
    /** Base spacing unit in pixels. @default 8 @minimum 1 */
    unit?: number;
}): {
    /** Strongest text colour, for titles and labels that must be read. */
    ink: string;
    /** Secondary text, for descriptions under a label. */
    note: string;
    /** Weakest text, for footnotes and axis ticks. */
    faint: string;
    /** Hairline colour for dividers and box outlines. */
    line: string;
    /** Page background, for a panel behind the drawing. */
    bg: string;
    /** Look up a tone's fill, stroke and text colour by name. */
    tone: (name: string) => Tone;
    /** Multiples of the base unit: space(2) is 16 with the default 8. */
    space: (steps: number) => number;
    /** The tone names available, for a legend. */
    toneNames: string[];
} {
    const base = THEMES[opts.name ?? "paper"] ?? THEMES.paper!;
    const unit = Number(opts.unit ?? UNIT);

    // The cascade: palette, then the caller's overrides, merged per tone so
    // changing one fill does not cost the matching stroke and text colour.
    const tones: Record<string, Tone> = {};
    for (const [name, tone] of Object.entries(base.tones)) tones[name] = { ...tone };
    for (const [name, patch] of Object.entries(opts.tones ?? {})) {
        tones[name] = { ...(tones[name] ?? base.tones.neutral!), ...patch };
    }

    return {
        ink: opts.colors?.ink ?? base.ink,
        note: opts.colors?.note ?? base.note,
        faint: opts.colors?.faint ?? base.faint,
        line: opts.colors?.line ?? base.line,
        bg: opts.colors?.bg ?? base.bg,
        tone: (name: string) => {
            const found = tones[name];
            if (!found) throw new Error(`svg: no tone "${name}" (have: ${Object.keys(tones).sort().join(", ")})`);
            return found;
        },
        // Halves are allowed because the gap inside a control is genuinely 4px;
        // anything finer than that is a decision to make by hand.
        space: (steps: number) => Math.round(unit * Number(steps) * 2) / 2,
        toneNames: Object.keys(tones),
    };
}
