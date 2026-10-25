/**
 * Draws a person as a small chip: avatar and name, with an online dot.
 * @param opts.userId Person to show.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Person to show. */
    userId: string;
}): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const u: any = await ctx.fns.auth.getUser({ id: opts.userId }).catch(() => null);
    const name = String(u?.name ?? opts.userId);
    const online = await ctx.fns.auth.online({}).then((html: any) => String(html).includes(opts.userId)).catch(() => false);
    return `<span class="w-person">${await ctx.fns.w.avatar({ name, src: u?.picture ?? undefined, size: 20 })}<span>${esc(name)}</span>${online ? ctx.fns.w.dot({ state: "running" }) : ""}</span>`;
}
