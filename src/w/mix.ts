/**
 * Turns one or more design mixins into a class string of named wx- atoms; later mixes override earlier ones.
 * Use it instead of inline style when a page arranges widgets: every value is a principle name
 * (gap "inside", text "small", radius "item"), so a number off the 4px grid or a stray colour cannot be written.
 * Mixins are plain objects, so they merge in code: w.mix({ mixes: [caption, { gap: "inside" }] }).
 * @param opts.mixes Mixins to merge, left to right; falsy entries are skipped.
 * @param opts.class Extra class names appended verbatim (a widget's own class).
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Mixins to merge, left to right; falsy entries are skipped. */
    mixes: Array<types.w.Mixin | null | undefined | false>;
    /** Extra class names appended verbatim (a widget's own class). */
    class?: string;
}): string {
    const m: types.w.Mixin = Object.assign({}, ...opts.mixes.filter(Boolean));
    const out: string[] = [];
    if (m.layout) out.push(`wx-${m.layout}`);
    if (m.wrap) out.push("wx-wrap");
    if (m.grow) out.push("wx-grow");
    if (m.scroll) out.push("wx-scroll");
    if (m.align) out.push(`wx-align-${m.align}`);
    if (m.justify) out.push(`wx-justify-${m.justify}`);
    if (m.gap) out.push(`wx-gap-${m.gap}`);
    if (m.pad) out.push(`wx-pad-${m.pad}`);
    if (m.padX) out.push(`wx-padx-${m.padX}`);
    if (m.padY) out.push(`wx-pady-${m.padY}`);
    if (m.text) out.push(`wx-text-${m.text}`);
    if (m.weight) out.push(`wx-weight-${m.weight}`);
    if (m.ink) out.push(`wx-ink-${m.ink}`);
    if (m.mono) out.push("wx-mono");
    if (m.caption) out.push("wx-caption");
    if (m.truncate) out.push("wx-truncate");
    if (m.radius) out.push(`wx-radius-${m.radius}`);
    if (m.line) out.push(`wx-line-${m.line}`);
    if (m.raised) out.push("wx-raised");
    if (opts.class) out.push(opts.class);
    return out.join(" ");
}
