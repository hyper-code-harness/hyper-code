/** Closes the USER_PLUGINS clone watcher during graceful shutdown. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    if (_session) throw new Error("plugins stop is lifecycle-only");
    return ctx.fns.plugins.watchClones({ stop: true });
}
