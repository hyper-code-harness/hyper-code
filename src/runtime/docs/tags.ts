/**
 * Lists the declared function tags with who declared them and how many loaded functions carry each.
 *
 * Use to see which tags exist before filtering runtime.docs.search({ tag }), or to check a new `$tag_<name>.ts`
 * registered. Counts come from the running functions and leave out memory-level functions the caller may not
 * run. Tags written in JSDoc but declared nowhere are reported by code.quality (`unknown-tag`), not here.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    _opts: {},
): Promise<Array<{ name: string; summary: string; arg?: string; repeatable?: boolean; module: string; rel: string; count: number }>> {
    const declared: Record<string, types.runtime.docs.RegisteredTag> = (ctx.state as any).tags ?? {};
    const counts = new Map<string, number>();
    const hidden = new Set(session ? await ctx.fns.runtime.docs.hiddenModules({}) : []);
    for (const item of ctx.fns.runtime.docs.list({})) {
        if (hidden.has(item.name.split(".")[0] ?? "")) continue;
        const meta = ctx.fns.runtime.docs.get({ name: item.name });
        for (const name of Object.keys(meta.tags ?? {})) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Object.values(declared).map(tag => ({ ...tag, count: counts.get(tag.name) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}
