/**
 * Starts (or stops) the file watcher that hot-reloads plugin clones in USER_PLUGINS, in production and in dev
 *
 * Use at boot (plugins/$start.ts calls it) so that a save in USER_PLUGINS/<plugin>/src goes live without a restart,
 * the way ~/.hyper/src functions do; the dev watcher only covers the repository's own src. Watches the USER_PLUGINS
 * folder recursively, collects changed paths and after a quiet period hands them to plugins.reloadCloneFiles.
 * Idempotent: a second start returns `already`. PLUGIN_WATCH=0 disables it. With stop:true closes the watcher.
 * @param opts.stop Close the running watcher instead. @default false
 * @param opts.debounceMs Quiet period before a batch is reloaded. @default 200
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Close the running watcher instead. @default false */
    stop?: boolean;
    /** Quiet period before a batch is reloaded. @default 200 */
    debounceMs?: number;
}): Promise<{ watching: string | null; status: 'started' | 'already' | 'stopped' | 'disabled' }> {
    const path = await import('node:path');
    const os = await import('node:os');
    const { watch, mkdirSync } = await import('node:fs');
    const st = ((ctx.state as any).plugins ??= {}) as { cloneWatcher?: { close(): void; dir: string; timer?: ReturnType<typeof setTimeout> } };
    if (opts.stop) {
        const w = st.cloneWatcher;
        if (w) { if (w.timer) clearTimeout(w.timer); w.close(); delete st.cloneWatcher; }
        return { watching: null, status: 'stopped' };
    }
    if (st.cloneWatcher) return { watching: st.cloneWatcher.dir, status: 'already' };
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!configured || ctx.env.PLUGIN_WATCH === '0') return { watching: null, status: 'disabled' };
    const dir = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    mkdirSync(dir, { recursive: true });
    const pending = new Set<string>();
    let running: Promise<unknown> | null = null;
    const flush = async () => {
        if (running) { await running; }
        const files = [...pending];
        pending.clear();
        if (!files.length) return;
        running = ctx.fns.plugins.reloadCloneFiles({ files }).catch(e => console.error('[plugins.watch]', e));
        await running;
        running = null;
    };
    const watcher = watch(dir, { recursive: true }, (_event, rel) => {
        if (!rel) return;
        const parts = String(rel).split('/');
        if (parts.some(p => p === 'node_modules' || p === '.git') || parts[0]!.startsWith('.')) return;
        pending.add(path.join(dir, String(rel)));
        const w = st.cloneWatcher;
        if (!w) return;
        if (w.timer) clearTimeout(w.timer);
        w.timer = setTimeout(() => { w.timer = undefined; flush().catch(e => console.error('[plugins.watch]', e)); }, opts.debounceMs ?? 200);
    });
    st.cloneWatcher = { close: () => watcher.close(), dir };
    ctx.fns.procs.log.info({ event: 'plugins.watch.started', msg: dir });
    return { watching: dir, status: 'started' };
}
