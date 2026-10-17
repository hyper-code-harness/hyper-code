/**
 * Builds the function module name of a person's memory level: `user_` + the user id with every character
 * other than a letter or digit replaced by `_`.
 *
 * Use to tell an agent where its person's functions live: `m.rijikov` → `user_m_rijikov`, so the folder is
 * `~/.hyper/src/user_m_rijikov/` and calls are `ctx.fns.user_m_rijikov.<fn>`.
 * @param opts.userId User id, e.g. `niquola` or `m.rijikov`.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** User id, e.g. `niquola` or `m.rijikov`. */
        userId: string;
    },
): Promise<string> {
    return "user_" + String(opts.userId ?? "").replace(/[^A-Za-z0-9]/g, "_");
}
