/**
 * Rejects private result-store paths before public file serving or listing.
 *
 * Use at public HTTP file boundaries and when filtering directory listings. Detects .hyper/results path segments and local symlink aliases of the configured result store. Remote paths are canonicalized on their SSH host.
 * @param opts.path Local workspace-relative or absolute path, or remote path when host is supplied.
 * @param opts.host SSH alias for a remote filesystem path.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Local workspace-relative or absolute path, or remote path when host is supplied. */
        path: string;
        /** SSH alias for a remote filesystem path. */
        host?: string;
    },
): Promise<boolean> {
    const { resolve } = await import('node:path');
    const { realpath } = await import('node:fs/promises');
    const matches = (p: string) => ('/' + p + '/').includes('/.hyper/results/');
    const path = opts.host ? opts.path : ctx.fns.files.resolveSafe({ path: opts.path });
    if (matches(path)) return true;
    if (opts.host) {
     const q = ctx.fns.remote.quote({value:path,path:true});
     const r = await ctx.fns.remote.exec({host:opts.host,command:'realpath -- '+q,timeout:30});
     return r.exitCode !== 0 || matches(r.stdout.trim());
    }
    const canonical = await realpath(path).catch(() => path);
    if (matches(canonical)) return true;
    const store = await ctx.fns.resultStore.root({});
    const canonicalStore = await realpath(store).catch(() => resolve(store));
    return [resolve(store), canonicalStore].some(root => [path,canonical].some(p => p === root || p.startsWith(root + '/')));
}
