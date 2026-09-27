/**
 * Scrolls with the mouse wheel at the current pointer position or at given screen coordinates.
 *
 * Positive dy scrolls content up (wheel up), negative dy scrolls down; dx scrolls horizontally. Units are wheel lines. Requires Accessibility permission.
 * @param opts.dy Vertical lines; negative scrolls down.
 * @param opts.dx Horizontal lines. @default 0
 * @param opts.x Move the pointer to this horizontal screen coordinate first.
 * @param opts.y Move the pointer to this vertical screen coordinate first.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Vertical lines; negative scrolls down. */
        dy: number;
        /** Horizontal lines. @default 0 */
        dx?: number;
        /** Move the pointer to this horizontal screen coordinate first. */
        x?: number;
        /** Move the pointer to this vertical screen coordinate first. */
        y?: number;
    },
): Promise<{ ok: boolean }> {
    if (opts.x !== undefined && opts.y !== undefined) await ctx.fns.desktop.helper({ args: ["move", String(opts.x), String(opts.y)] });
    await ctx.fns.desktop.helper({ args: ["scroll", String(Math.round(opts.dy)), String(Math.round(opts.dx ?? 0))] });
    await Bun.sleep(200);
    return { ok: true };
}
