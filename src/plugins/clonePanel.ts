/**
 * Renders the git panel of an installed plugin clone: status badges, git facts and Edit / Release / Update / Rollback / Fork / Sync upstream buttons
 *
 * Use on the plugin page (GET /plugins/:name) for a plugin whose folder is a git clone in USER_PLUGINS; returns ''
 * for anything else. Edit, Release, Fork and Sync upstream post to POST /plugins/:name/git with a CSRF token;
 * Release and Fork push or create something outside this machine and first show a confirmation (`confirm`).
 * Update and Rollback open the reviewed preview of the plugin catalog (POST /plugins/listing), which confirms by
 * digest. Buttons that cannot apply right now (Release on a detached tag, Update with local work) are left out.
 * @param opts.name Plugin name (folder under USER_PLUGINS).
 * @param opts.req Page request, for the CSRF token.
 * @param opts.notice Result line to show above the buttons (after an action).
 * @param opts.error Error line to show above the buttons.
 * @param opts.confirm Operation awaiting confirmation: shows its confirm form instead of the buttons.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name (folder under USER_PLUGINS). */
    name: string;
    /** Page request, for the CSRF token. */
    req: Request;
    /** Result line to show above the buttons (after an action). */
    notice?: string;
    /** Error line to show above the buttons. */
    error?: string;
    /** Operation awaiting confirmation: shows its confirm form instead of the buttons. */
    confirm?: { operation: 'release' | 'fork' | 'merge'; detail: string };
}): Promise<string> {
    let dir: string;
    try { dir = (await ctx.fns.plugins.cloneDir({ name: opts.name })).dir; } catch { return ''; }
    const st = await ctx.fns.plugins.cloneStatus({ dir });
    if (!st.git || !st.commit) return '';
    let lock: types.plugins.PluginLock['plugins'][string] | undefined;
    try { lock = (await ctx.fns.plugins.lockFile({})).lock.plugins[opts.name]; } catch { lock = undefined; }
    const norm = (u: string) => u.replace(/^git\+/, '').replace(/^github:/, 'https://github.com/').replace(/^git@github\.com:/, 'https://github.com/').replace(/^file:\/\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
    const git: types.plugins.CloneGit = {
        ...(lock ? { lockedTag: lock.tag } : {}),
        ...(st.tag ? { tag: st.tag } : {}), commit: st.commit,
        ...(st.branch ? { branch: st.branch } : {}), ...(st.baseTag ? { baseTag: st.baseTag } : {}),
        sinceTag: st.sinceTag, dirty: st.dirty, unpushed: st.unpushed, ahead: st.ahead, behind: st.behind,
        ...(st.origin ? { origin: st.origin } : {}), ...(st.upstream ? { upstream: st.upstream } : {}),
        fork: !!(st.upstream || (lock && st.origin && norm(st.origin) !== norm(lock.repo))),
    };
    const esc = (v: unknown) => Bun.escapeHTML(String(v ?? ''));
    const csrf = await ctx.fns.auth.csrfField({ req: opts.req });
    const self = `/plugins/${encodeURIComponent(opts.name)}/git`;
    const button = (fields: Record<string, string>, label: string, primary = false, action = self) =>
        `<form method="POST" action="${action}">${action === self ? csrf : ''}${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}<button class="pl-button${primary ? '' : ' pl-secondary'}" type="submit" data-git-action="${esc(fields.operation)}">${esc(label)}</button></form>`;
    const badges = ctx.fns.plugins.cloneBadge({ git }).map(b => `<span class="pl-badge" data-badge="${b.kind}">${esc(b.label)}</span>`).join(' ');
    const local = git.dirty.length > 0 || git.unpushed.length > 0;
    const rows: Array<[string, string]> = [
        ['Commit', `<code>${esc(git.commit.slice(0, 12))}</code>${git.tag ? ` · <code>${esc(git.tag)}</code>` : ''}`],
        ['Branch', git.branch ? `<code>${esc(git.branch)}</code>${git.ahead || git.behind ? ` · ${git.ahead} ahead, ${git.behind} behind` : ''}` : 'detached at the release'],
        ...(lock ? [['Installed', `<code>${esc(lock.repo)}</code> · <code>${esc(lock.tag)}</code>${lock.previous.length ? ` · ${lock.previous.length} earlier` : ''}`] as [string, string]] : []),
        ...(git.origin ? [['Origin', `<code>${esc(git.origin)}</code>`] as [string, string]] : []),
        ...(git.upstream ? [['Upstream', `<code>${esc(git.upstream)}</code>`] as [string, string]] : []),
        ...(git.dirty.length ? [['Uncommitted', git.dirty.slice(0, 20).map(f => `<code>${esc(f)}</code>`).join(' ')] as [string, string]] : []),
        ...(git.unpushed.length ? [['Unpushed', git.unpushed.slice(0, 10).map(c => `<code>${esc(c)}</code>`).join('<br>')] as [string, string]] : []),
    ];
    let actions: string;
    if (opts.confirm) {
        const label = { release: 'Confirm release', fork: 'Confirm fork', merge: 'Confirm merge' }[opts.confirm.operation];
        actions = `<p class="text-sm text-muted">${esc(opts.confirm.detail)}</p><div class="mt-3 flex flex-wrap gap-2">${button({ operation: opts.confirm.operation, confirmed: 'true' }, label, true)}<a class="pl-button pl-secondary" href="/plugins/${encodeURIComponent(opts.name)}">Cancel</a></div>`;
    } else {
        const list = [
            !git.branch ? button({ operation: 'edit' }, 'Edit', true) : '',
            git.branch && !git.dirty.length ? button({ operation: 'release' }, 'Release') : '',
            lock && !local ? button({ operation: 'install', name: opts.name }, 'Update', false, '/plugins/listing') : '',
            lock && !local && lock.previous.length ? button({ operation: 'rollback', name: opts.name }, 'Rollback', false, '/plugins/listing') : '',
            !git.upstream && /github\.com/.test(git.origin ?? '') ? button({ operation: 'fork' }, 'Fork') : '',
            git.upstream ? button({ operation: 'sync' }, 'Sync upstream') : '',
        ].filter(Boolean);
        actions = `<div class="flex flex-wrap gap-2">${list.join('')}</div>`;
    }
    return `<section class="mt-7" data-git-panel="${esc(opts.name)}"><div class="mb-3 flex flex-wrap items-center gap-2"><h2 class="font-medium">Git clone</h2>${badges}</div>`
        + (opts.error ? `<p class="pl-alert" role="alert">${esc(opts.error)}</p>` : '')
        + (opts.notice ? `<p class="pl-alert" role="status">${esc(opts.notice)}</p>` : '')
        + `<dl class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xs">${rows.map(([k, v]) => `<div class="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-t border-base-200 px-4 py-3 first:border-t-0"><dt class="text-xs text-faint">${esc(k)}</dt><dd class="min-w-0 break-words text-sm text-muted">${v}</dd></div>`).join('')}</dl>`
        + `<div class="mt-4">${actions}</div></section>`;
}
