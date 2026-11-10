/**
 * Reads or writes the plugin lock file that records which repository, tag and commit each git-cloned plugin came from
 *
 * Use to find out what a clone in USER_PLUGINS was installed from, or (with `lock`) to save a changed lock
 * atomically. The file is PLUGINS_LOCK when set, otherwise plugins.lock.json next to the USER_PLUGINS folder
 * (~/.hyper/plugins.lock.json for ~/.hyper/user). A missing file reads as an empty lock; a malformed one throws.
 * @param opts.lock Lock to write; omit to only read.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Lock to write; omit to only read. */
    lock?: types.plugins.PluginLock;
}): Promise<{ path: string; lock: types.plugins.PluginLock }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const home = String(ctx.env.HOME || os.homedir());
    const expand = (p: string) => path.resolve(p.replace(/^~(?=\/)/, home));
    const explicit = String(ctx.env.PLUGINS_LOCK ?? '').trim();
    const mount = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!explicit && !mount) throw new Error('USER_PLUGINS is not configured');
    const file = explicit ? expand(explicit) : path.join(path.dirname(expand(mount)), 'plugins.lock.json');
    if (opts.lock) {
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(opts.lock, null, 2) + '\n');
        await fs.rename(tmp, file);
        return { path: file, lock: opts.lock };
    }
    const text = await fs.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
    if (text === null) return { path: file, lock: { plugins: {} } };
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || !raw.plugins || typeof raw.plugins !== 'object' || Array.isArray(raw.plugins))
        throw new Error('Malformed plugin lock: ' + file);
    for (const [name, e] of Object.entries(raw.plugins) as Array<[string, any]>)
        if (!e || typeof e.repo !== 'string' || typeof e.tag !== 'string' || !/^[0-9a-f]{40}$/.test(String(e.commit)) || !Array.isArray(e.previous))
            throw new Error(`Malformed plugin lock entry ${name}: ${file}`);
    return { path: file, lock: raw as types.plugins.PluginLock };
}
