/**
 * Refreshes gap declarations from current mounted roots including an empty scan
 *
 * Use to discover added, overridden or removed gap declarations without a server restart. Explicitly clears the registry when the last declaration was removed, because the core loader skips empty kinds.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<void> {
    const entries=(await ctx.fns.procs.project.scan({})).filter(e=>e.kind==='gap');
    const loader=(ctx.state as any).procs.boot.loaders.gap;
    await loader(ctx,session,{entries});
}
