/**
 * Reads the configured plugin listings and returns their validated entries, merged in listing order
 *
 * Use to know what can be installed. The setting plugins.listings (env PLUGIN_LISTINGS) is an ordered list of
 * index.json addresses, https:// or file://; a company or a person can add their own listing next to the public one.
 * Each entry says which listing it came from. A name found in several listings keeps the first one's entry and the
 * others are reported in errors — never silently replaced. A listing that cannot be read or is malformed is reported
 * in errors too and the others still count. Format 2: each entry has a lowercase name, label, description, optional
 * ph-* icon and a `github:owner/repo` source (a file:// listing may also use `git+file:///path` repositories) — no
 * version; releases are the repository's vX.Y.Z tags (plugins.versions).
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
            for (const entry of await readOne(url, errors)) {
                const first = plugins.find(p => p.name === entry.name);
                if (first) errors.push(`${entry.name}: also in ${url}; the entry of ${first.listing} is used`);
                else plugins.push(entry);
            }
        } catch (e) { errors.push(`${url}: ${e instanceof Error ? e.message : 'unreadable'}`); }
    }
    return { urls, plugins, errors };
}

/** One listing: fetched, checked as format 2, malformed entries reported in errors. */
async function readOne(url: string, errors: string[]): Promise<types.plugins.ListingEntry[]> {
    if (!/^(https|file):\/\//.test(url)) throw new Error('Listing URL must be https:// or file://');
    let raw: unknown;
    if (url.startsWith('file://')) raw = JSON.parse(await (await import('node:fs/promises')).readFile(new URL(url), 'utf8'));
    else {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`Listing request failed: HTTP ${res.status}`);
        const text = await res.text();
        if (text.length > 1_000_000) throw new Error('Listing too large');
        raw = JSON.parse(text);
    }
    const index = raw as { format?: unknown; plugins?: unknown };
    if (!index || index.format !== 2 || !Array.isArray(index.plugins)) throw new Error('Listing must be { format: 2, plugins: [...] }');
    // A listing on this machine (file://) may point at local git repositories too; a remote one only at GitHub.
    const local = url.startsWith('file://');
    const plugins: types.plugins.ListingEntry[] = [];
    const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
    for (const item of index.plugins.slice(0, 500) as Array<Record<string, unknown>>) {
        const name = String(item?.name ?? '?');
        if (!item || typeof item !== 'object'
            || !/^[a-z][a-z0-9-]{0,63}$/.test(name)
            || !(/^github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(item.source)) || (local && /^git\+file:\/\/\/[^\s]+$/.test(String(item.source))))
            || !text(item.label, 200) || !text(item.description, 2000)
            || (item.icon !== undefined && !/^ph-[a-z0-9-]+$/.test(String(item.icon)))) {
            errors.push(`${name}: invalid entry in ${url}`);
            continue;
        }
        if (plugins.some(p => p.name === name)) { errors.push(`${name}: duplicate in ${url}`); continue; }
        plugins.push({
            name, label: String(item.label), description: String(item.description),
            ...(item.icon ? { icon: String(item.icon) } : {}),
            source: String(item.source),
            listing: url,
        });
    }
    return plugins;
}
