/**
 * Lists offline installed plugins with their provenance lock and drift status
 *
 * Reads local metadata and bounded trees without contacting providers or executing code. Conflicting locks are invalid; legacy installations without content SHA256 remain untrusted.
 * A git clone (what plugins.install puts there) carries `git`: ref mode (tag, branch, commit) with the lock tag or
 * followed branch and, for a branch, the new commits origin had at the last fetch; HEAD tag, commit, branch, uncommitted
 * files, unpushed commits, ahead/behind and whether origin is a fork of the installed repository; its status is
 * `clone` (clean, at a tag), `branch` (on a branch or ahead of its tag), `edited` (local work not on a remote) or
 * `local` (a private plugin in a git repository without a remote, see plugins.gitInit; `edited` when it has uncommitted files).
 * A folder that is not a git repository is `unmanaged`: plugins.gitInit turns it into a local one.
 */
export default async function (ctx: Context, session: Session | null, opts: {}): Promise<{
    plugins: Array<{
        name: string;
        selection?: types.plugins.ProviderSelection;
        previousSelection?: types.plugins.ProviderSelection;
        version?: string;
        label?: string;
        description?: string;
        icon?: string;
        managed: boolean;
        status: string;
        modified?: boolean;
        /** Git state of a clone in USER_PLUGINS; absent for a folder that is not a git repository. */
        git?: types.plugins.CloneGit;
    }>;
    errors: string[];
}> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const plugins: Array<{
        name: string;
        selection?: types.plugins.ProviderSelection;
        previousSelection?: types.plugins.ProviderSelection;
        version?: string;
        label?: string;
        description?: string;
        icon?: string;
        managed: boolean;
        status: string;
        modified?: boolean;
        git?: types.plugins.CloneGit;
    }> = [];
    const errors: string[] = [];
    const mount = ctx.env.USER_PLUGINS;
    if (!mount)
        return { plugins, errors };
    let entries;
    try {
        entries = await fs.readdir(mount, { withFileTypes: true });
    }
    catch (e) {
        return { plugins, errors: ['Inventory unavailable'] };
    }
    // Git state is an addition to the inventory: without a readable lock or git it is just absent.
    let locked: types.plugins.PluginLock['plugins'] = {};
    try { locked = (await ctx.fns.plugins.lockFile({})).lock.plugins; } catch { locked = {}; }
    const same = (a: string, b: string) => {
        const norm = (u: string) => u.replace(/^git\+/, '').replace(/^github:/, 'https://github.com/').replace(/^git@github\.com:/, 'https://github.com/').replace(/^file:\/\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
        return norm(a) === norm(b);
    };
    const gitOf = async (name: string, dir: string) => {
        let st: Awaited<ReturnType<typeof ctx.fns.plugins.cloneStatus>> | null = null;
        try { st = await ctx.fns.plugins.cloneStatus({ dir }); } catch { st = null; }
        if (!st?.git || !st.commit) return undefined;
        const lock = locked[name];
        const { git: _g, ...rest } = st;
        // Branch mode counts what origin/<branch> had at the last fetch (offline); plugins.branchUpdates asks origin.
        const mode = !lock ? undefined : lock.branch ? 'branch' as const : lock.tag ? 'tag' as const : 'commit' as const;
        return { ...rest, commit: st.commit, ...(lock?.tag ? { lockedTag: lock.tag } : {}), ...(lock?.branch ? { lockedBranch: lock.branch } : {}), ...(mode ? { mode } : {}),
            ...(mode === 'branch' && st.branch === lock!.branch ? { newCommits: st.behind } : {}), ...(!st.origin && !st.upstream ? { local: true } : {}), fork: !!(st.upstream || (lock && st.origin && !same(st.origin, lock.repo))) };
    };
    for (const entry of entries) {
        const name = entry.name;
        if (name.startsWith('.'))
            continue;
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            plugins.push({ name, managed: false, status: 'invalid' });
            continue;
        }
        const dir = path.join(mount, name);
        let metadata: {
            version?: string;
            label?: string;
            description?: string;
            icon?: string;
        } = {};
        try {
            const pkg = await ctx.fns.plugins.readMetadata({ path: path.join(dir, 'package.json') });
            const procs = pkg.procs && typeof pkg.procs === 'object' && !Array.isArray(pkg.procs) ? pkg.procs : {};
            metadata = {
                version: typeof pkg.version === 'string' ? pkg.version : undefined,
                label: typeof procs.label === 'string' ? procs.label : undefined,
                description: typeof procs.description === 'string' ? procs.description
                    : typeof pkg.description === 'string' ? pkg.description : undefined,
                icon: typeof procs.icon === 'string' ? procs.icon : undefined,
            };
            const read = async (file: string) => { try {
                return await ctx.fns.plugins.readMetadata({ path: path.join(dir, file) });
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                    return null;
                throw e;
            } };
            const lock = await read('.plugin-lock.json');
            const version = typeof pkg.version === 'string' ? pkg.version : undefined;
            if (!lock) {
                const git = await gitOf(name, dir);
                // No remote: a private plugin in a local repository — its commits cannot be "unpushed".
                const status = !git ? 'unmanaged' : git.local ? (git.dirty.length ? 'edited' : 'local') : git.dirty.length || git.unpushed.length ? 'edited' : git.branch || git.ahead ? 'branch' : 'clone';
                plugins.push({ name, ...metadata, version, managed: false, status, ...(git ? { git } : {}) });
                continue;
            }
            const selection = lock.selection as types.plugins.ProviderSelection;
            if (
                !selection
                || selection.name !== name
                || typeof selection.provider !== 'string'
                || typeof selection.revision !== 'string'
                || !selection.source
                || typeof selection.source !== 'object'
                || Array.isArray(selection.source)
                || Object.values(selection.source).some(v => typeof v !== 'string')
            )
                throw new Error('Invalid provenance');
            const previousSelection = lock.previousSelection as types.plugins.ProviderSelection | undefined;
            if (typeof lock.contentDigest !== 'string' || !/^[0-9a-f]{64}$/.test(lock.contentDigest))
                throw new Error('Lock has no content digest');
            const modified = (await ctx.fns.plugins.validateTree({ dir })).digest !== lock.contentDigest;
            plugins.push({ name, ...metadata, version, selection, previousSelection, managed: true, status: modified ? 'modified' : 'managed', modified });
        }
        catch (e) {
            plugins.push({ name, ...metadata, managed: false, status: 'invalid' });
            errors.push(name + ': Invalid local metadata or tree');
        }
    }
    return { plugins, errors };
}
