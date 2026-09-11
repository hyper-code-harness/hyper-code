/**
 * Runs the expensive retrieval-text localization pass, but only inside the
 * configured night window. Reload-time indexing skips localization entirely
 * (`localize: false`), so this job is what eventually fills `localized_text`.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** First hour of the local night window, inclusive. @default 2 */
        fromHour?: number;
        /** Last hour of the local night window, exclusive. @default 7 */
        toHour?: number;
        /** Functions localized per run. @default 100 */
        localizationBatch?: number;
        /** Localize regardless of the clock. @default false */
        anyTime?: boolean;
    } = {},
): Promise<{ skipped: boolean; hour: number; functions?: any; plugins?: any }> {
    const fromHour = Number(opts.fromHour ?? 2);
    const toHour = Number(opts.toHour ?? 7);
    const hour = new Date().getHours();
    const inWindow = fromHour <= toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour;
    if (!opts.anyTime && !inWindow) return { skipped: true, hour };
    const localizationBatch = Math.max(1, Math.min(100, Number(opts.localizationBatch ?? 100)));
    const functions = await ctx.fns.runtime.docs.index({ localizationBatch });
    const plugins = await ctx.fns.plugins.index({ localizationBatch: Math.min(50, localizationBatch) });
    ctx.fns.procs.log.info({
        event: "runtime.localize.nightly",
        localized: functions?.localized ?? 0,
        pending: functions?.pendingLocalization ?? 0,
    });
    return { skipped: false, hour, functions, plugins };
}
