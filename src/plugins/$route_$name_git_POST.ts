/**
 * Runs one git action on an installed plugin clone from its page: edit, release, share in the network, fork, sync upstream or switch ref
 *
 * POST /plugins/:name/git, URL-encoded, same-origin and with the page's CSRF token. `edit` switches the clone to
 * main (plugins.edit). `release` and `fork` push to or create a repository outside this machine, so the first post
 * only shows what will happen and `confirmed=true` does it (plugins.release, plugins.fork). `share` publishes a local
 * plugin to this Hyper's place in its network (plugins.publish without an address): the first post shows the preview
 * — repository, owner, listing, version, who is recorded as the publisher — and the confirmation carries its digest. `sync` fetches upstream
 * and reports behind/ahead (plugins.syncUpstream); `merge` with confirmed=true merges it. `switch` with kind
 * (tag, branch or commit) and ref previews moving the clone there (plugins.install) and shows the review whose
 * Confirm applies it by digest. Answers with the plugin
 * page, the git panel showing the result or the error.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */ req: Request;
    /** Route parameters with the plugin name. */ params: Record<string, string>;
}) {
    const req = opts.req;
    const origin = req.headers.get('origin');
    if (!origin || origin !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site')
        return new Response('Same-origin request required', { status: 403 });
    if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
        return new Response('URL-encoded form required', { status: 415 });
    const text = await req.text();
    if (text.length > 4096) return new Response('Request too large', { status: 413 });
    const form = new URLSearchParams(text);
    const allowed = ['_csrf', 'operation', 'confirmed', 'kind', 'ref', 'digest'];
    if ([...form.keys()].some(k => !allowed.includes(k)) || allowed.some(k => form.getAll(k).length > 1))
        return new Response('Invalid fields', { status: 400 });
    if (!await ctx.fns.auth.verifyCsrf({ req, token: form.get('_csrf') ?? '' })) return new Response('Invalid CSRF token', { status: 403 });
    const name = opts.params.name ?? '';
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) return new Response('Invalid plugin name', { status: 400 });
    const operation = form.get('operation') ?? '';
    if (!['edit', 'release', 'share', 'fork', 'sync', 'merge', 'switch'].includes(operation)) return new Response('Invalid operation', { status: 400 });
    // Switch to another ref: answer with the reviewed preview of plugins.install; its Confirm posts to /plugins/listing with the digest.
    if (operation === 'switch') {
        const kind = form.get('kind') ?? '', ref = (form.get('ref') ?? '').trim();
        if (!['tag', 'branch', 'commit'].includes(kind) || !ref || ref.length > 100) return new Response('Invalid ref', { status: 400 });
        const pick = kind === 'tag' ? { version: ref.replace(/^v/, '') } : kind === 'branch' ? { branch: ref } : { commit: ref.toLowerCase() };
        try {
            const change = await ctx.fns.plugins.install({ name, ...pick });
            return { title: name, main: await ctx.fns.plugins.listingPage({ change }) };
        } catch (e) {
            const page = new URL(`/plugins/${encodeURIComponent(name)}`, req.url);
            const result = await ctx.fns.plugins.clonePanel({ name, req: new Request(page.href, { headers: { cookie: req.headers.get('cookie') ?? '' } }), error: e instanceof Error ? e.message.slice(0, 1000) : 'Switch failed' });
            return { title: name, main: `<link rel="stylesheet" href="/plugins/plugins.css"><div class="pl"><a href="/plugins/${encodeURIComponent(name)}" class="pl-back">Back to ${Bun.escapeHTML(name)}</a>${result}</div>` };
        }
    }
    const confirmed = form.get('confirmed') === 'true';
    const panel: { notice?: string; error?: string; confirm?: { operation: 'release' | 'fork' | 'merge' | 'share'; detail: string; digest?: string; rows?: Array<[string, string]> } } = {};
    try {
        if (operation === 'edit') {
            const r = await ctx.fns.plugins.edit({ name });
            panel.notice = `On branch ${r.branch}${r.created ? ' (new)' : ''} at ${r.commit.slice(0, 7)}: edit the files, commit, then Release.`;
        } else if (operation === 'release') {
            if (!confirmed) panel.confirm = { operation: 'release', detail: `Runs the plugin tests, bumps the patch version, commits, tags and pushes the branch and the tag to origin. Other machines can then install the new release.` };
            else { const r = await ctx.fns.plugins.release({ name }); panel.notice = `Released ${r.tag} (${r.commit.slice(0, 7)}) to ${r.pushed}.`; }
        } else if (operation === 'share') {
            const digest = form.get('digest') ?? '';
            if (confirmed && !/^[0-9a-f]{64}$/.test(digest)) return new Response('Invalid digest', { status: 400 });
            const r = await ctx.fns.plugins.publish({ name, ...(confirmed ? { confirmed: true, expectedDigest: digest } : {}) });
            if (r.status === 'published') {
                panel.notice = `Published ${r.tag} to ${r.repo}. ` + (r.listing.status === 'added' || r.listing.status === 'already-listed'
                    ? 'It is in the network catalog: other Hypers see it within a minute.'
                    : r.listing.status === 'push-refused' ? `The catalog did not take the entry (${r.listing.detail}).` : 'No shared catalog: others install it by its address.');
            } else {
                panel.confirm = {
                    operation: 'share', digest: r.digest,
                    detail: 'Publishes this plugin inside the network of this Hyper: its code goes to a repository every Hyper of the network can read, and it appears in their plugin catalog. Nothing leaves the network.',
                    rows: [
                        ['Repository', `${r.repo}${r.creates ? ' (will be created)' : ''}`],
                        ['Owner', r.home?.owner ?? ''],
                        ['Version', `${r.tag}${r.packageChanges.length ? ` — ${r.packageChanges.join('; ')}` : ''}`],
                        ['Catalog', r.listing.status === 'will-add' ? `${r.listing.repo}: adds "${r.entry.label}" — ${r.entry.description}` : r.listing.status === 'already-listed' ? `${r.listing.repo}: already there` : 'none on this network'],
                        ['Published by', r.home?.publishedBy ?? ''],
                        ['Files', `${r.files.length}: ${r.files.slice(0, 12).join(', ')}${r.files.length > 12 ? ', …' : ''}`],
                        ['Tests', r.tests.ran ? 'passed' : 'the plugin has none'],
                        ...(r.home?.notes ?? []).map(n => ['Note', n] as [string, string]),
                    ].filter(([, v]) => v) as Array<[string, string]>,
                };
            }
        } else if (operation === 'fork') {
            if (!confirmed) panel.confirm = { operation: 'fork', detail: 'Creates a fork of the repository on your GitHub account; the current origin becomes upstream and origin points at the fork.' };
            else { const r = await ctx.fns.plugins.fork({ name }); panel.notice = `Forked: origin ${r.origin}, upstream ${r.upstream}.`; }
        } else {
            const r = await ctx.fns.plugins.syncUpstream({ name, merge: operation === 'merge' && confirmed });
            if (r.conflicts?.length) panel.error = `Merge of ${r.ref} conflicts in ${r.conflicts.join(', ')}; nothing was merged.`;
            else if (r.merged) panel.notice = `Merged ${r.ref}; now ${r.ahead} ahead.`;
            else if (r.behind > 0) panel.confirm = { operation: 'merge', detail: `${r.ref} is ${r.behind} commit${r.behind === 1 ? '' : 's'} ahead of this clone (this clone is ${r.ahead} ahead). Merge it into the current branch?` };
            else panel.notice = `Up to date with ${r.ref} (${r.ahead} ahead).`;
        }
    } catch (e) {
        panel.error = e instanceof Error ? e.message.slice(0, 1000) : 'Operation failed';
    }
    const page = new URL(`/plugins/${encodeURIComponent(name)}`, req.url);
    const result = await ctx.fns.plugins.clonePanel({ name, req: new Request(page.href, { headers: { cookie: req.headers.get('cookie') ?? '' } }), ...panel });
    return { title: name, main: `<link rel="stylesheet" href="/plugins/plugins.css"><div class="pl"><a href="/plugins/${encodeURIComponent(name)}" class="pl-back">Back to ${Bun.escapeHTML(name)}</a>${result || '<p class="pl-alert" role="alert">Not a git clone.</p>'}</div>` };
}
