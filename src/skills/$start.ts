/** Applies the stored "skills for every agent" choice and brings the skill index in line with the disk (shared folders change while Hyper is down). The index is not awaited — a start must not wait for it. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    if (_session) throw new Error("skills start is lifecycle-only");
    await ctx.fns.skills.setEnabled({}).catch((error: any) => ctx.fns.procs.log.warn({ event: "skills.enabled.failed", msg: String(error?.message ?? error) }));
    void ctx.fns.skills.index({ embed: false }).catch((error: any) => ctx.fns.procs.log.warn({ event: "skills.index.failed", msg: String(error?.message ?? error) }));
}
