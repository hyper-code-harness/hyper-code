/**
 * Looks up a repository on a hyper-git server and, when asked, creates the empty repository there — the optional hyper-git step of publishing a plugin
 *
 * Use from plugins.publish when the plugin's home is a hyper-git server (the git server of a private Hyper network)
 * and the repository may not exist yet. hyper-git serves a repository as `https://<host>/git/<id>.git` and creates
 * one with an empty `POST https://<host>/api/repos/<id>`; it has no accounts or tokens — the network in front of it
 * says who is calling, so this works exactly where `git push` to that server works. An address of another shape is
 * answered with `match: false` and no request is made. Without `create` it only looks: `exists` is true or false,
 * and absent when the server would not say (no access, unreachable). With `create` it sends the request and reports
 * `created` (false when the repository was already there); a server that answers anything but hyper-git's own reply
 * is refused, so an ordinary git host that happens to keep repositories under /git/ is never mistaken for one.
 * @param opts.repo Repository address, https://<host>/git/<id>.git.
 * @param opts.create Create the repository when it does not exist. @default false
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Repository address, https://<host>/git/<id>.git. */
        repo: string;
        /** Create the repository when it does not exist. @default false */
        create?: boolean;
    },
): Promise<{ match: boolean; server?: string; id?: string; exists?: boolean; created?: boolean }> {
    // The id grammar is hyper-git's own (repo.path): 1–8 lowercase segments.
    const m = /^https:\/\/([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?)\/git\/([a-z0-9][a-z0-9_-]{0,63}(?:\/[a-z0-9][a-z0-9_-]{0,63}){0,7})(?:\.git)?\/?$/.exec(String(opts.repo ?? '').trim());
    if (!m) return { match: false };
    const [, server, id] = m as unknown as [string, string, string];
    if (!opts.create) {
        // What git itself asks first; hyper-git answers 404 for a repository that is not there.
        const seen = await fetch(`https://${server}/git/${id}.git/info/refs?service=git-upload-pack`, { redirect: 'error', signal: AbortSignal.timeout(15_000) }).then(r => r.status, () => 0);
        return { match: true, server, id, ...(seen === 200 ? { exists: true } : seen === 404 ? { exists: false } : {}) };
    }
    let res: Response;
    try { res = await fetch(`https://${server}/api/repos/${id}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch (e) { throw new Error(`Cannot reach ${server} to create ${id}: ${e instanceof Error ? e.message : 'request failed'}`); }
    const body = await res.json().catch(() => null) as { id?: unknown; created?: unknown } | null;
    if (res.status === 401 || res.status === 403) throw new Error(`${server} refused to create ${id} (HTTP ${res.status}): this machine may create repositories only under its own team`);
    if ((res.status !== 200 && res.status !== 201) || body?.id !== id || typeof body.created !== 'boolean')
        throw new Error(`${server} did not answer as a hyper-git server (HTTP ${res.status}): create ${id} there yourself`);
    return { match: true, server, id, exists: true, created: body.created };
}
