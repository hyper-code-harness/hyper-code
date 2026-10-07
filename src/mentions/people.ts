/**
 * Lists the people who can be @mentioned on this Hyper instance.
 *
 * Active (not disabled) users with id, display name, email and picture, cached for a few seconds because
 * every rendered message asks. Use it for the composer's @ suggestions and to resolve @id in message text.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<Array<{ id: string; name: string; email: string | null; picture: string | null }>> {
    const cache = ((ctx.state as any).mentions ??= {}) as { people?: { at: number; list: any[] } };
    if (cache.people && Date.now() - cache.people.at < 5000) return cache.people.list;
    const users = await ctx.fns.auth.listUsers({});
    const list = users.map((u) => ({ id: u.id, name: u.name, email: u.email, picture: u.picture }));
    cache.people = { at: Date.now(), list };
    return list;
}
