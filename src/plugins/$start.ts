/** Starts the USER_PLUGINS clone watcher (plugins.watchClones) so plugin edits hot-reload in production too, and notes what the last Hyper update removed (plugins.dropped). */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    if (_session) throw new Error("plugins start is lifecycle-only");
    // What the last Hyper update took away, for the Dock and the log. Not awaited: it reads git and the catalog, and a
    // start must not wait for the network. Refreshed when a plugin is installed (plugins.gitInstall clears it).
    void ctx.fns.plugins.noteUpdate({}).then(() => ctx.fns.plugins.dropped({})).then(d => {
        (ctx.state as { droppedPlugins?: { at: number; names: string[] } }).droppedPlugins = { at: Date.now(), names: d.missing };
        if (d.missing.length) ctx.fns.procs.log.warn({ event: "plugins.dropped", msg: `the last Hyper update (${String(d.from).slice(0, 8)} → ${String(d.to).slice(0, 8)}) removed plugins this instance was using: ${d.missing.join(", ")} — install them from the catalog (/plugins/listing)` });
    }).catch(() => undefined);
    return ctx.fns.plugins.watchClones({});
}
