/**
 * Creates the first user once, from env or the legacy shared password, when no users exist.
 *
 * Sources: HYPER_USER / HYPER_USER_EMAIL for name and email, and HYPER_PASSWORD or the stored
 * auth.password setting for the password (hashed on write). Never overwrites existing users:
 * after the first user exists, env is ignored and changes go through the UI or auth functions.
 * A user seeded without HYPER_USER gets a placeholder name and is left unconfigured, so setup
 * asks for the real name. Returns the created user, or null when users already existed or
 * there was nothing to seed from.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<types.auth.User | null> {
    const any = await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM users LIMIT 1" }) as any[];
    if (any.length) return null;
    const name = String(ctx.env.HYPER_USER ?? "").trim();
    const email = String(ctx.env.HYPER_USER_EMAIL ?? "").trim() || null;
    const password = await ctx.fns.auth.password({});
    if (!name && !email && !password) return null;
    const user = await ctx.fns.auth.createUser({
        name: name || (email ? email.split("@")[0]! : "Owner"),
        email,
        password,
        role: "owner",
        configured: !!name,
    });
    ctx.fns.procs.log.info({ event: "auth.seeded", msg: `created first user ${user.id}${name ? "" : " (name pending setup)"}` });
    return user;
}
