/** Seeds the first user from env or the legacy password once, after migrations have run. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    try {
        await ctx.fns.auth.seed({});
    } catch (error: any) {
        ctx.fns.procs.log.error({ event: "auth.seed.failed", msg: String(error?.message ?? error) });
    }
    return {};
}
