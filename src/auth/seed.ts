/**
 * Creates the first user once from HYPER_USER / HYPER_USER_EMAIL / HYPER_PASSWORD, when no users exist.
 *
 * For fresh server deployments configured by env. Requires HYPER_USER; without it nothing is
 * created, so upgrading an existing install never invents a nameless user — that switch is done
 * explicitly with `bun script/multiuser.ts up`, and until then sign-in works exactly as before.
 * Never overwrites existing users: after the first user exists, env is ignored.
 * Returns the created user, or null when users already existed or HYPER_USER is not set.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<types.auth.User | null> {
    const name = String(ctx.env.HYPER_USER ?? "").trim();
    if (!name) return null;
    const any = await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM users LIMIT 1" }) as any[];
    if (any.length) return null;
    const email = String(ctx.env.HYPER_USER_EMAIL ?? "").trim() || null;
    const password = await ctx.fns.auth.password({});
    const user = await ctx.fns.auth.createUser({ name, email, password, role: "owner", configured: true });
    ctx.fns.procs.log.info({ event: "auth.seeded", msg: `created first user ${user.id} from env` });
    return user;
}
