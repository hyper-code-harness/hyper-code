/**
 * Wraps HTML in a div arranged by merged design mixins — the layout glue between widgets, with no inline style.
 * Use for stacks, rows and padded areas on a page built from w.* widgets; spacing, type and corners come only
 * from principle names, so the result stays on the grid.
 * @param opts.body Inner HTML (already rendered widgets).
 * @param opts.mix One mix or several merged left to right.
 * @param opts.tag Element name. @default "div"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Inner HTML (already rendered widgets). */
    body: string;
    /** One mix or several merged left to right. */
    mix?: types.w.Mixin | Array<types.w.Mixin | null | undefined | false>;
    /** Element name. @default "div" */
    tag?: "div" | "section" | "header" | "footer" | "nav" | "span";
}): string {
    const tag = opts.tag ?? "div";
    const mixes = Array.isArray(opts.mix) ? opts.mix : [opts.mix];
    const cls = ctx.fns.w.mix({ mixes });
    return `<${tag}${cls ? ` class="${cls}"` : ""}>${opts.body}</${tag}>`;
}
