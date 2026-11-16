/**
 * Checks, without changing anything, whether a local plugin can be published from this Hyper right now, and says in plain words what is missing
 *
 * Use before offering "share in the network" to a person, and when plugins.publish fails and the reason should be
 * found in one call. It goes through what a publication needs, in order: a writable USER_PLUGINS; git on this
 * machine; the plugin being a clean local git repository on a branch, not published yet; a description for the
 * catalog; nothing that looks like a secret in the tracked files (plugins.secretScan); this Hyper's place in its
 * network (plugins.home: the server answers, an owner is known, the listing is writable); the name being free in the
 * catalog and the repository not existing yet with other content. With an explicit `repo` the network checks are
 * replaced by "the repository is reachable". Each check is `ok`, `fail` (publishing would stop) or `note` (worth
 * knowing, e.g. commits will be authored by "Hyper" because git has no user.name). It does not run the plugin's tests
 * — the preview of plugins.publish does.
 * @param opts.name Plugin name (folder under USER_PLUGINS).
 * @param opts.repo Publish to this repository instead of this Hyper's place in its network (plugins.home).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name (folder under USER_PLUGINS). */
    name: string;
    /** Publish to this repository instead of this Hyper's place in its network (plugins.home). */
    repo?: string;
}): Promise<{
    name: string;
    /** No check failed: plugins.publish can be previewed. */
    ready: boolean;
    /** Where it would be published, when that is known. */
    repo?: string;
    listing?: string;
    checks: Array<{ id: string; status: 'ok' | 'fail' | 'note'; detail: string }>;
}> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const name = String(opts.name ?? '');
    const checks: Array<{ id: string; status: 'ok' | 'fail' | 'note'; detail: string }> = [];
    const add = (id: string, status: 'ok' | 'fail' | 'note', detail: string) => { checks.push({ id, status, detail }); return status !== 'fail'; };
    const done = (extra: { repo?: string; listing?: string } = {}) => ({ name, ready: checks.every(c => c.status !== 'fail'), ...extra, checks });

    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!configured) { add('user-plugins', 'fail', 'USER_PLUGINS is not set: this Hyper has no folder for its own plugins'); return done(); }
    const mount = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const writable = await fs.access(mount, (await import('node:fs')).constants.W_OK).then(() => true, () => false);
    if (!add('user-plugins', writable ? 'ok' : 'fail', writable ? mount : `${mount} is not writable by this Hyper`)) return done();
    const gitVersion = Bun.spawnSync(['git', '--version']);
    if (!add('git', gitVersion.exitCode === 0 ? 'ok' : 'fail', gitVersion.exitCode === 0 ? gitVersion.stdout.toString().trim() : 'git is not installed on this machine')) return done();

    let dir: string;
    try { dir = (await ctx.fns.plugins.cloneDir({ name })).dir; }
    catch (e) { add('plugin', 'fail', /not a git clone/.test(String((e as Error)?.message)) ? `${name} is a plain folder: put it under git with plugins.gitInit({ name: "${name}" })` : `${name}: ${(e as Error)?.message ?? 'not found'}`); return done(); }
    const st = await ctx.fns.plugins.cloneStatus({ dir });
    if (st.origin) { add('plugin', 'fail', `${name} is already published (${st.origin}): release new versions with plugins.release, or register it with plugins.addToListing`); return done(); }
    add('plugin', !st.branch ? 'fail' : st.dirty.length ? 'fail' : 'ok', !st.branch ? 'on a detached HEAD: switch to a branch (plugins.edit)' : st.dirty.length ? `uncommitted changes: ${st.dirty.slice(0, 8).join(', ')} — commit them first` : `on ${st.branch} at ${String(st.commit).slice(0, 7)}, clean`);
    const pkg = await fs.readFile(path.join(dir, 'package.json'), 'utf8').then(JSON.parse, () => null);
    add('description', pkg?.procs?.description ? 'ok' : 'fail', pkg?.procs?.description ? String(pkg.procs.description).slice(0, 160) : 'package.json has no procs.description: the catalog needs one sentence about what the plugin does');
    const id = (await ctx.fns.plugins.cloneDir({ name, args: ['config', 'user.name'], allowFailure: true })).stdout && (await ctx.fns.plugins.cloneDir({ name, args: ['config', 'user.email'], allowFailure: true })).stdout;
    add('git-identity', id ? 'ok' : 'note', id ? 'git knows who commits' : 'git has no user.name/user.email here: the release commit will be authored by "Hyper"');
    const secrets = await ctx.fns.plugins.secretScan({ name });
    add('secrets', secrets.findings.length ? 'fail' : 'ok', secrets.findings.length
        ? `looks like a secret: ${secrets.findings.slice(0, 5).map(f => `${f.kind} in ${f.file}${f.line ? ':' + f.line : ''}`).join('; ')}`
        : `${secrets.files} tracked files, nothing that looks like a key or a token`);

    let repo = opts.repo, listing: string | undefined, creates = false;
    if (!repo) {
        const home = await ctx.fns.plugins.home({ fresh: true });
        if (!home.ready || !home.repo) { add('home', 'fail', home.problems.join('; ') || 'plugins.home is not set'); return done(); }
        repo = home.repo.replace('<name>', name); listing = home.listing; creates = true;
        add('home', 'ok', `${home.identity ? `${home.identity.kind} ${home.identity.id}` : 'not confirmed by the server'} → owner "${home.owner}" on ${home.server}`);
        for (const p of home.problems) add('home-note', /does not let this Hyper write|refused|Cannot reach/.test(p) ? 'fail' : 'note', p);
    }
    let target: Awaited<ReturnType<typeof ctx.fns.plugins.repoUrl>>;
    try { target = await ctx.fns.plugins.repoUrl({ repo }); } catch { add('repository', 'fail', `${repo} is not a repository address`); return done(); }
    // The repository: missing (and creatable here) or empty. Anything in it means another plugin lives there.
    const seen = Bun.spawnSync(['git', 'ls-remote', target.url], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 30_000 });
    if (seen.exitCode === 0) {
        const refs = seen.stdout.toString().split('\n').filter(l => l && !l.endsWith('\tHEAD')).length;
        add('repository', refs ? 'fail' : 'ok', refs ? `${target.source} already has content (${refs} refs): the name is taken there — choose another name` : `${target.source} exists and is empty`);
    } else {
        const mesh = target.kind === 'https' ? await ctx.fns.plugins.hyperGitRepo({ repo: target.url }).catch(() => ({ match: false as const })) : { match: false as const };
        const missing = mesh.match && (mesh as { exists?: boolean }).exists === false;
        add('repository', missing && creates ? 'ok' : missing ? 'note' : 'fail', missing
            ? `${target.source} does not exist yet${creates ? ' and will be created' : ': publish with createRepo: true'}`
            : `cannot reach ${target.source}: ${(seen.stderr.toString().trim().split('\n').at(-1) ?? '').slice(0, 160)}`);
    }
    const known = await ctx.fns.plugins.listing({}).then(l => l.plugins.find(p => p.name === name), () => undefined);
    const taken = known && (await ctx.fns.plugins.repoUrl({ repo: known.source })).key !== target.key;
    add('name', taken ? 'fail' : 'ok', taken ? `the catalog already lists ${name} from ${known!.source}: choose another name` : known ? 'already in the catalog, from this repository' : 'free in the catalog');
    return done({ repo: target.source, ...(listing ? { listing } : {}) });
}
