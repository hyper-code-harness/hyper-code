/**
 * Adds, updates or removes one plugin's entry in a listing repository and pushes it — retrying when somebody else published at the same moment, never forcing
 *
 * Use from plugins.publish, plugins.addToListing and plugins.unpublish; it is the only place that writes a listing.
 * A listing is `plugins/<name>.json` per plugin plus the generated `index.json` (format 2). Each attempt works on a
 * fresh copy of the listing's branch: it writes (or deletes) this plugin's file only, regenerates `index.json` from
 * all entry files in file-name order, commits and pushes. When the push is refused because the branch moved meanwhile
 * (another publisher), it fetches and applies the same one change again, up to `attempts` times. When the branch did
 * not move, the server said no (no rights, or the rule of a network catalog): the answer is `refused` with what the
 * server said, and nothing is retried. An entry of the same name that points at another repository is never
 * overwritten or removed: that stops with an error. Other entries are carried over untouched.
 * @param opts.listing Address of the listing repository.
 * @param opts.name Plugin name: the entry is plugins/<name>.json.
 * @param opts.entry The entry to write; null removes the plugin from the listing.
 * @param opts.source The plugin's own repository (canonical): an existing entry must point at it to be changed or removed.
 * @param opts.message Commit message.
 * @param opts.attempts How many times to try when the listing keeps moving. @default 3 @minimum 1 @maximum 5
 * @param opts.dryRun Only say what would happen (the same checks, the same status), without committing or pushing. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Address of the listing repository. */
    listing: string;
    /** Plugin name: the entry is plugins/<name>.json. */
    name: string;
    /** The entry to write; null removes the plugin from the listing. */
    entry: { name: string; label: string; icon?: string; description: string; source: string; publishedBy?: string } | null;
    /** The plugin's own repository (canonical): an existing entry must point at it to be changed or removed. */
    source: string;
    /** Commit message. */
    message: string;
    /** How many times to try when the listing keeps moving. @default 3 @minimum 1 @maximum 5 */
    attempts?: number;
    /** Only say what would happen (the same checks, the same status), without committing or pushing. @default false */
    dryRun?: boolean;
}): Promise<{
    /** `added` / `updated` / `removed` — pushed (with dryRun: would be); `unchanged` — the entry was already exactly this; `absent` — nothing to remove; `refused` — the server did not take the push. */
    status: 'added' | 'updated' | 'removed' | 'unchanged' | 'absent' | 'refused';
    /** The listing repository in canonical form. */
    repo: string;
    /** Commit of the listing that carries the change. */
    commit?: string;
    /** For `refused`: what the server said. */
    detail?: string;
    /** Pushes tried. */
    attempts: number;
}> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const name = String(opts.name ?? '');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid plugin name');
    if (opts.entry && opts.entry.name !== name) throw new Error('The entry is for another plugin');
    const l = await ctx.fns.plugins.repoUrl({ repo: opts.listing });
    const mine = (await ctx.fns.plugins.repoUrl({ repo: opts.source })).key;
    const max = Math.max(1, Math.min(5, Math.floor(Number(opts.attempts ?? 3)) || 3));
    const run = async (cwd: string, args: string[], env: Record<string, string> = {}) => {
        const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
        const timer = setTimeout(() => p.kill(), 120_000);
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        clearTimeout(timer);
        return { ok: code === 0, out: out.trim(), err: err.trim() };
    };
    const last = (text: string) => (text.split('\n').at(-1) ?? '').slice(0, 300);
    const KEYS = ['name', 'label', 'icon', 'description', 'source', 'publishedBy'];
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-plugin-listing-'));
    const dir = path.join(tmp, 'listing');
    try {
        const cloned = await run(tmp, ['clone', '-q', '--depth', '1', l.url, dir]);
        if (!cloned.ok) throw new Error(`Cannot read the listing repository ${l.source}: ${last(cloned.err)}`);
        const notListing = () => new Error(`${l.source} is not a plugin listing: it needs plugins/<name>.json files and an index.json of format 2`);
        // An empty repository has no branch at all: it is simply not a listing.
        const head = await run(dir, ['symbolic-ref', '--short', 'HEAD']);
        const branch = head.ok && (await run(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])).ok ? head.out : '';
        if (!branch) throw notListing();
        const idKnown = (await run(dir, ['config', 'user.name'])).out && (await run(dir, ['config', 'user.email'])).out;
        const who: Record<string, string> = idKnown ? {} : { GIT_AUTHOR_NAME: 'Hyper', GIT_AUTHOR_EMAIL: 'hyper@localhost', GIT_COMMITTER_NAME: 'Hyper', GIT_COMMITTER_EMAIL: 'hyper@localhost' };
        for (let attempt = 1; ; attempt++) {
            const base = (await run(dir, ['rev-parse', 'HEAD'])).out;
            const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8').catch(() => 'null'));
            if (index?.format !== 2 || !Array.isArray(index.plugins) || !(await fs.lstat(path.join(dir, 'plugins')).catch(() => null))?.isDirectory())
                throw notListing();
            const file = path.join(dir, 'plugins', name + '.json');
            const there = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'));
            if (there && (await ctx.fns.plugins.repoUrl({ repo: String(there.source) }).catch(() => ({ key: '' }))).key !== mine)
                throw new Error(`The listing ${l.source} already has a plugin named ${name} from ${there.source}`);
            if (!opts.entry && !there) return { status: 'absent', repo: l.source, attempts: attempt - 1 };
            if (opts.entry) await fs.writeFile(file, JSON.stringify(opts.entry, null, 2) + '\n');
            else await fs.rm(file);
            const all: Array<Record<string, unknown>> = [];
            for (const f of (await fs.readdir(path.join(dir, 'plugins'))).filter(f => f.endsWith('.json')).sort()) {
                const p = JSON.parse(await fs.readFile(path.join(dir, 'plugins', f), 'utf8'));
                all.push(Object.fromEntries(KEYS.filter(k => p[k] !== undefined).map(k => [k, p[k]])));
            }
            await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ format: 2, plugins: all }, null, 2) + '\n');
            await run(dir, ['add', '-A', '--', `plugins/${name}.json`, 'index.json']);
            if ((await run(dir, ['diff', '--cached', '--quiet'])).ok) return { status: 'unchanged', repo: l.source, commit: base, attempts: attempt - 1 };
            const what = !opts.entry ? 'removed' as const : there ? 'updated' as const : 'added' as const;
            if (opts.dryRun) return { status: what, repo: l.source, attempts: 0 };
            const c = await run(dir, ['commit', '-q', '-m', opts.message], who);
            if (!c.ok) throw new Error(`git commit in the listing failed: ${last(c.err)}`);
            const pushed = await run(dir, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
            if (pushed.ok) {
                (ctx.state as { pluginListingRepos?: Map<string, unknown> }).pluginListingRepos?.clear();
                return { status: what, repo: l.source, commit: (await run(dir, ['rev-parse', 'HEAD'])).out, attempts: attempt };
            }
            // Why: somebody else pushed first (the branch moved — apply the one change again on top), or the server
            // said no (the branch is where it was — trying again changes nothing).
            const said = pushed.err.split('\n').map(s => s.replace(/^remote:\s*/, '').trim()).find(s => /guard:|denied|forbidden|permission|protected/i.test(s)) ?? last(pushed.err);
            const tip = await run(dir, ['ls-remote', 'origin', `refs/heads/${branch}`]);
            const now = tip.ok ? tip.out.split(/\s+/)[0] : undefined;
            if (!now || now === base) return { status: 'refused', repo: l.source, detail: said.slice(0, 300), attempts: attempt };
            if (attempt >= max) return { status: 'refused', repo: l.source, detail: `the listing changed ${attempt} times while publishing: try again`, attempts: attempt };
            await Bun.sleep(100 + Math.floor(Math.random() * 400));
            const f = await run(dir, ['fetch', '-q', '--depth', '1', 'origin', `refs/heads/${branch}`]);
            if (!f.ok) return { status: 'refused', repo: l.source, detail: last(f.err), attempts: attempt };
            await run(dir, ['reset', '-q', '--hard', 'FETCH_HEAD']);
        }
    } finally {
        await fs.rm(tmp, { recursive: true, force: true });
    }
}
