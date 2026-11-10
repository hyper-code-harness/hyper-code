/**
 * Lists the releases of a plugin repository: its vX.Y.Z tags, newest first, with the commit each points at
 *
 * Use to find what can be installed or updated for a listing entry. Runs `git ls-remote --tags` against the
 * source (`github:owner/repo`, or any git URL such as git+file:// in tests); other tags and prereleases are ignored.
 * Results are cached in memory for a few minutes per source so a catalog page does not hit GitHub on every view.
 * @param opts.source Repository, `github:owner/repo` or a git URL.
 * @param opts.fresh Bypass the cache. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository, `github:owner/repo` or a git URL. */
    source: string;
    /** Bypass the cache. @default false */
    fresh?: boolean;
}): Promise<Array<{ tag: string; version: string; commit: string }>> {
    const source = String(opts.source ?? '');
    const url = /^github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(source)
        ? `https://github.com/${source.slice(7)}.git`
        : /^git\+(file|https):\/\//.test(source) ? source.slice(4) : '';
    if (!url) throw new Error('Unsupported plugin source: ' + source);
    const cache: Map<string, { at: number; list: Array<{ tag: string; version: string; commit: string }> }> =
        ((ctx.state as any).pluginVersions ??= new Map());
    const hit = cache.get(url);
    if (hit && !opts.fresh && Date.now() - hit.at < 5 * 60_000) return hit.list;
    const p = Bun.spawn(['git', 'ls-remote', '--tags', url], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const timer = setTimeout(() => p.kill(), 20_000);
    const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    clearTimeout(timer);
    if (code) throw new Error(`git ls-remote failed for ${source}: ${err.trim().split('\n').at(-1)?.slice(0, 200) ?? code}`);
    const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;
    const tags = new Map<string, string>();
    for (const line of out.split('\n').filter(Boolean)) {
        const [sha, ref] = line.split('\t') as [string, string];
        const m = /^refs\/tags\/(.+?)(\^\{\})?$/.exec(ref ?? '');
        if (!m || !SEMVER.test(m[1]!)) continue;
        // An annotated tag is listed twice; the peeled `^{}` line carries the commit.
        if (m[2] || !tags.has(m[1]!)) tags.set(m[1]!, sha);
    }
    const key = (t: string) => SEMVER.exec(t)!.slice(1).map(Number) as [number, number, number];
    const list = [...tags].map(([tag, commit]) => ({ tag, version: tag.slice(1), commit }))
        .sort((a, b) => { const x = key(a.tag), y = key(b.tag); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
    cache.set(url, { at: Date.now(), list });
    return list;
}
