/**
 * Reads the configured plugin listings and returns their validated entries, merged in listing order
 *
 * Use to know what can be installed. The setting plugins.listings (env PLUGIN_LISTINGS) is an ordered list of
 * index.json addresses, https:// or file://; a company or a person can add their own listing next to the public one.
 * An https address ending in .git is a listing kept as a git repository (plugins/<name>.json files and the generated
 * index.json, what plugins.publish writes): its index.json is read with git, so a private git server needs no raw-file
 * endpoint and the listing is visible to exactly those who can clone it.
 * Each entry says which listing it came from. A name found in several listings keeps the first one's entry and the
 * others are reported in errors — never silently replaced. A listing that cannot be read or is malformed is reported
 * in errors too and the others still count. Format 2: each entry has a lowercase name, label, description, optional
 * ph-* icon and a `source` — the plugin's git repository on any server: `github:owner/repo`, `https://host/path`,
 * `ssh://git@host/path` or `git@host:path` (plugins.repoUrl; a file:// listing may also use `git+file:///path`
 * repositories on this machine) — and no version; releases are the repository's vX.Y.Z tags (plugins.versions).
 * @param opts.urls Listing addresses to read instead of the plugins.listings setting.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Listing addresses to read instead of the plugins.listings setting. */
    urls?: string[];
}): Promise<{ urls: string[]; plugins: types.plugins.ListingEntry[]; errors: string[] }> {
    const configured: unknown = opts.urls ?? await ctx.fns.settings.get({ module: 'plugins', scopeType: 'global', key: 'listings' });
    const urls = [...new Set((Array.isArray(configured) ? configured.map(String) : String(configured ?? '').split(/[\s,]+/)).map(u => u.trim()).filter(Boolean))];
    const plugins: types.plugins.ListingEntry[] = [];
    const errors: string[] = [];
    for (const url of urls) {
        try {
            for (const entry of await readOne(ctx, url, errors)) {
                const first = plugins.find(p => p.name === entry.name);
                if (first) errors.push(`${entry.name}: also in ${url}; the entry of ${first.listing} is used`);
                else plugins.push(entry);
            }
        } catch (e) { errors.push(`${url}: ${e instanceof Error ? e.message : 'unreadable'}`); }
    }
    return { urls, plugins, errors };
}

/** One listing: fetched, checked as format 2, malformed entries reported in errors. */
async function readOne(ctx: Context, url: string, errors: string[]): Promise<types.plugins.ListingEntry[]> {
    if (!/^(https|file):\/\//.test(url)) throw new Error('Listing URL must be https:// or file://');
    let raw: unknown;
    if (url.startsWith('file://')) raw = JSON.parse(await (await import('node:fs/promises')).readFile(new URL(url), 'utf8'));
    else if (/\.git\/?$/.test(url)) raw = JSON.parse(await fromRepository(ctx, url));
    else {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`Listing request failed: HTTP ${res.status}`);
        const text = await res.text();
        if (text.length > 1_000_000) throw new Error('Listing too large');
        raw = JSON.parse(text);
    }
    const index = raw as { format?: unknown; plugins?: unknown };
    if (!index || index.format !== 2 || !Array.isArray(index.plugins)) throw new Error('Listing must be { format: 2, plugins: [...] }');
    // A source is a git repository on any server (plugins.repoUrl). Only a listing on this machine (file://) may
    // point at repositories on this machine: a remote listing must not make this server read local paths.
    const local = url.startsWith('file://');
    const source = async (v: unknown) => {
        try { const r = await ctx.fns.plugins.repoUrl({ repo: String(v ?? '') }); return r.kind === 'file' && !local ? null : r.source; }
        catch { return null; }
    };
    const plugins: types.plugins.ListingEntry[] = [];
    const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
    for (const item of index.plugins.slice(0, 500) as Array<Record<string, unknown>>) {
        const name = String(item?.name ?? '?');
        let src: string | null = null;
        if (!item || typeof item !== 'object'
            || !/^[a-z][a-z0-9-]{0,63}$/.test(name)
            || !(src = await source(item.source))
            || !text(item.label, 200) || !text(item.description, 2000)
            || (item.icon !== undefined && !/^ph-[a-z0-9-]+$/.test(String(item.icon)))) {
            errors.push(`${name}: invalid entry in ${url}`);
            continue;
        }
        if (plugins.some(p => p.name === name)) { errors.push(`${name}: duplicate in ${url}`); continue; }
        plugins.push({
            name, label: String(item.label), description: String(item.description),
            ...(item.icon ? { icon: String(item.icon) } : {}),
            ...(text(item.publishedBy, 200) ? { publishedBy: String(item.publishedBy) } : {}),
            source: src,
            listing: url,
        });
    }
    return plugins;
}

/**
 * index.json of a listing kept as a git repository (an https address ending in .git): a git server that serves
 * repositories and no raw files — one inside a private network — is read with the git access this machine has,
 * the same one that later clones the plugins. A shallow, blob-less fetch of the default branch into a temporary
 * folder; nothing of the repository is run and nothing is kept. Cached for a minute, like the tags of a plugin.
 */
async function fromRepository(ctx: Context, url: string): Promise<string> {
    const cache: Map<string, { at: number; text: string }> = ((ctx.state as { pluginListingRepos?: Map<string, { at: number; text: string }> }).pluginListingRepos ??= new Map());
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 60_000) return hit.text;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const repo = await ctx.fns.plugins.repoUrl({ repo: url });
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-plugin-listing-'));
    try {
        const git = async (args: string[]) => {
            const p = Bun.spawn(['git', ...args], { cwd: tmp, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
            const timer = setTimeout(() => p.kill(), 30_000);
            const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
            clearTimeout(timer);
            if (code) throw new Error(`Cannot read the listing repository: ${(err.trim().split('\n').at(-1) ?? String(code)).slice(0, 200)}`);
            return out;
        };
        await git(['clone', '-q', '--depth', '1', '--no-checkout', '--filter=blob:limit=1m', '--', repo.url, 'listing']);
        const text = await git(['-C', 'listing', 'show', 'HEAD:index.json']);
        if (text.length > 1_000_000) throw new Error('Listing too large');
        cache.set(url, { at: Date.now(), text });
        return text;
    } finally {
        await fs.rm(tmp, { recursive: true, force: true });
    }
}
