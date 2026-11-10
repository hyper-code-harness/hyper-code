/**
 * Hot-reloads changed files of plugin clones in USER_PLUGINS: functions, routes, scripts and styles
 *
 * Use with absolute paths of files that changed under USER_PLUGINS (plugins.watchClones calls it after a debounce).
 * Files outside a mounted plugin's procs.src, in node_modules or .git, and tests are ignored. A changed function is
 * reloaded on its own (procs.repl.load); a new namespace folder or a changed package.json remounts plugins
 * (procs.modules.reload); routes, websockets, scripts and styles reload the route table and rebuild the
 * stylesheets. A file that fails to load is put on the error board (ctx.state.procs.dev.errors, shown with every
 * REPL answer) and the previously loaded version keeps running; a file that loads again is taken off the board.
 * @param opts.files Absolute paths of the files that changed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute paths of the files that changed. */
    files: string[];
}): Promise<{ reloaded: string[]; routes: boolean; remounted: boolean; errors: Record<string, string> }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    const out = { reloaded: [] as string[], routes: false, remounted: false, errors: {} as Record<string, string> };
    if (!configured) return out;
    const mount = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const board: Map<string, string> = (((ctx.state.procs as any).dev ??= {}).errors ??= new Map());
    const modules = ctx.state.procs.modules ?? [];
    const srcOf = new Map<string, string | null>();
    let needTypes = false, needRemount = false, needRoutes = false;
    const fns = new Set<string>();
    for (const abs of [...new Set(opts.files)]) {
        if (!abs.startsWith(mount + '/')) continue;
        const [plugin, ...rest] = abs.slice(mount.length + 1).split('/');
        if (!plugin || plugin.startsWith('.') || !rest.length || rest.some(s => s === 'node_modules' || s === '.git' || s.startsWith('.'))) continue;
        const relInPlugin = rest.join('/');
        if (relInPlugin === 'package.json') { needRemount = true; continue; }
        if (!srcOf.has(plugin)) {
            const pkg = JSON.parse(await fs.readFile(path.join(mount, plugin, 'package.json'), 'utf8').catch(() => 'null'));
            const procs = pkg?.procs ?? pkg?.proc;
            srcOf.set(plugin, procs && typeof procs === 'object' ? String(procs.src ?? 'src').replace(/\/+$/, '') : null);
        }
        const src = srcOf.get(plugin);
        if (!src || (src !== '.' && !relInPlugin.startsWith(src + '/'))) continue;
        const rel = src === '.' ? relInPlugin : relInPlugin.slice(src.length + 1);
        if (rel.endsWith('.test.ts') || rel.endsWith('.d.ts')) continue;
        const entry = ctx.fns.procs.project.classify({ rel });
        if (entry.kind === 'skip') continue;
        const ns = entry.moduleDir.split('/')[0]!;
        const owner = modules.find(m => m.namespaces.includes(ns));
        const pluginDir = path.join(mount, plugin);
        const real = await fs.realpath(pluginDir).catch(() => pluginDir);
        const ownerDir = owner ? await fs.realpath(owner.dir).catch(() => owner.dir) : '';
        if (owner && ownerDir !== real && !ownerDir.startsWith(real + '/')) continue; // someone else's namespace
        if (!owner) { needRemount = true; continue; }                             // a namespace not mounted yet
        const key = `${plugin}/${relInPlugin}`;
        const exists = await fs.lstat(abs).then(() => true, () => false);
        if (!exists) { board.delete(key); needTypes = true; continue; }
        if (entry.kind === 'fn') fns.add(JSON.stringify([key, entry.moduleDir.replaceAll('/', '.') + '.' + entry.runtimeName]));
        else if (['route', 'ws', 'script', 'style', 'middleware'].includes(entry.kind)) { needRoutes = true; board.delete(key); }
        else if (entry.kind === 'type') { needTypes = true; board.delete(key); }
        else needRemount = true;
    }
    if (needRemount) {
        try { await ctx.fns.procs.modules.reload({}); out.remounted = true; board.delete('USER_PLUGINS'); }
        catch (e: any) { out.errors.USER_PLUGINS = String(e?.message ?? e); board.set('USER_PLUGINS', out.errors.USER_PLUGINS); }
    }
    for (const item of fns) {
        const [key, name] = JSON.parse(item) as [string, string];
        try {
            await ctx.fns.procs.repl.load({ name });
            board.delete(key);
            out.reloaded.push(name);
            needTypes = true;
        } catch (e: any) {
            out.errors[key] = String(e?.message ?? e);
            board.set(key, out.errors[key]!);
            console.error(`[plugins.watch] ${key}: ${out.errors[key]}`);
        }
    }
    try {
        if (needRoutes && !out.remounted) {
            await ctx.fns.procs.http.loadRoutes({});
            await ctx.fns.procs.styles.rebuild({});
            out.routes = true;
        }
        if (needTypes && !out.remounted) await ctx.fns.procs.dev.genTypes({});
        if (out.reloaded.length || out.routes) ctx.fns.procs.events.reload({});
    } catch (e: any) {
        out.errors.post = String(e?.message ?? e);
        console.error(`[plugins.watch] post: ${out.errors.post}`);
    }
    return out;
}
