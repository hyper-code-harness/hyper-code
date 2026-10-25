/**
 * Draws a small trend line of a number series (inline SVG, no axes), stretched to its box: a fallback chart or a
 * trend next to a number. Fewer than two numbers draw an empty box.
 * @param opts.values The series, oldest first; non-numbers are skipped.
 * @param opts.tone Line colour meaning. @default "info"
 * @param opts.size Height: sm 24 px next to text, md 32 px, lg 96 px as a chart. @default "md"
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** The series, oldest first; non-numbers are skipped. */
    values: number[];
    /** Line colour meaning. @default "info" */
    tone?: "info" | "success" | "warning" | "danger";
    /** Height: sm 24 px next to text, md 32 px, lg 96 px as a chart. @default "md" */
    size?: "sm" | "md" | "lg";
}): string {
    const v = opts.values.filter(n => typeof n === "number" && Number.isFinite(n));
    const head = `class="w-spark" data-tone="${opts.tone ?? "info"}" data-size="${opts.size ?? "md"}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"`;
    if (v.length < 2) return `<svg ${head}></svg>`;
    const [min, max] = [Math.min(...v), Math.max(...v)];
    const span = max - min || 1, step = 100 / (v.length - 1);
    const d = v.map((n, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(28 - ((n - min) / span) * 26).toFixed(1)}`).join(" ");
    return `<svg ${head}><path d="${d}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
}
