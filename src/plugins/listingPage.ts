/**
 * Renders the plugin catalog with search and install, update and remove actions, or the review of one pending change
 *
 * Use for /plugins/listing. Without a change it shows plugins.catalog (optionally filtered by q): each listed plugin
 * with its newest release, installed version, the plugins it requires and buttons that open a preview. With a change
 * (a GitChange) it shows the repository, tag and commit, the plugins cloned alongside, new packages, the file diff,
 * local work a removal would delete and a Confirm form bound to the preview digest. Forms post to POST /plugins/listing; nothing is applied without that confirm.
 * @param opts.q Search words passed to plugins.catalog.
 * @param opts.change A previewed change to review, or an applied one to report.
 * @param opts.error Error message to show above the list.
 * @param opts.embed Keep embed mode (`?embed=1`, no app navigation) on every link and form, for the framed catalog. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Search words passed to plugins.catalog. */
    q?: string;
    /** A previewed change to review, or an applied one to report. */
    change?: types.plugins.GitChange;
    /** Error message to show above the list. */
    error?: string;
    /** Keep embed mode (`?embed=1`, no app navigation) on every link and form, for the framed catalog. @default false */
    embed?: boolean;
}): Promise<string> {
    const esc = (v: unknown) => Bun.escapeHTML(String(v ?? ''));
    const self = opts.embed ? '/plugins/listing?embed=1' : '/plugins/listing';
    const icon = (v?: string) => v && /^ph-[a-z0-9-]+$/.test(v) ? `<i class="ph ${esc(v)}" aria-hidden="true"></i>` : '⊞';
    const form = (fields: Record<string, string>, label: string, primary = false) =>
        `<form method="POST" action="${self}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}<button class="pl-button${primary ? '' : ' pl-secondary'}" type="submit">${esc(label)}</button></form>`;
    const head = `<link rel="stylesheet" href="/plugins/plugins.css"><div class="pl"><header class="pl-head"><div class="pl-mark" aria-hidden="true">⊞</div><div><h1>Plugin catalog</h1><p class="pl-sub">Plugins from their own repositories, installed as git clones after review</p></div></header>${opts.embed ? '' : '<nav class="pl-tabs" aria-label="Extensions"><a href="/plugins">Sources</a><a href="/plugins?tab=installed">Installed</a><a href="/plugins/listing" aria-current="page">Catalog</a></nav>'}`;
    const err = opts.error ? `<p class="pl-alert" role="alert">${esc(opts.error)}</p>` : '';
    const codes = (items: string[]) => items.map(i => `<code>${esc(i)}</code>`).join(' ') || 'none';

    const c = opts.change;
    if (c) {
        const list = (title: string, items: string[]) => items.length ? `<h3>${esc(title)} · ${items.length}</h3><ul class="pl-files">${items.slice(0, 200).map(i => `<li><code>${esc(i)}</code></li>`).join('')}</ul>` : '';
        const verb = { install: 'Install', update: 'Update', remove: 'Remove', rollback: 'Roll back' }[c.operation];
        const done = c.status !== 'preview';
        // Install and update are confirmed through plugins.install (it recomputes the same companions); remove and
        // rollback through plugins.uninstall and plugins.gitInstall.
        const confirm: Record<string, string> = c.operation === 'install' || c.operation === 'update'
            ? { operation: 'install', name: c.name, version: (c.tag ?? '').replace(/^v/, ''), digest: c.digest, confirmed: 'true' }
            : { operation: c.operation, name: c.name, digest: c.digest, confirmed: 'true', ...(c.needsForce ? { force: 'true' } : {}) };
        const body = `<section class="pl-section"><div class="pl-section-head"><h2>${esc(verb)} ${esc(c.name)}${c.plugin?.version ? ' ' + esc(c.plugin.version) : ''}</h2><span class="pl-origin">${done ? (c.status === 'applied' ? 'Applied' : 'Applied, but remounting failed') : 'Preview · nothing changed yet'}</span></div>`
            + (c.loadError ? `<p class="pl-alert" role="alert">${esc(c.loadError)}</p>` : '')
            + `<dl class="pl-review">${c.repo ? `<dt>Repository</dt><dd><code>${esc(c.repo)}</code></dd>` : ''}${c.tag ? `<dt>Release</dt><dd><code>${esc(c.tag)}</code> · commit <code>${esc((c.commit ?? '').slice(0, 12))}</code></dd>` : ''}${c.from ? `<dt>Now at</dt><dd><code>${esc(c.from.tag ?? 'untagged')}</code> · commit <code>${esc(c.from.commit.slice(0, 12))}</code></dd>` : ''}`
            + (c.plugin ? `<dt>Namespaces</dt><dd>${codes(c.plugin.namespaces.map(n => 'ctx.fns.' + n))}</dd><dt>Requires</dt><dd>${codes(c.plugin.requires)}</dd><dt>npm dependencies</dt><dd>${codes(Object.entries(c.plugin.dependencies).map(([k, v]) => k + '@' + v))}</dd>` : '')
            + (c.companions?.length ? `<dt>Also installs</dt><dd>${c.companions.map(p => `<code>${esc(p.name)}${p.version ? ' ' + esc(p.version) : ''}</code> <span class="pl-origin">(${esc(p.repo)}#${esc(p.tag)})</span>`).join('<br>')}</dd>` : '')
            + `<dt>New packages</dt><dd>${c.newPackages.length > 40 ? codes(c.newPackages.slice(0, 40)) + ` … and ${c.newPackages.length - 40} more` : codes(c.newPackages)}</dd>${c.blockedScripts ? `<dt>Scripts</dt><dd>${esc(c.blockedScripts)} — not run</dd>` : ''}</dl>`
            + list('Added', c.added) + list('Changed', c.changed) + list('Removed', c.removed)
            + (c.needsForce ? `<p class="pl-alert" role="alert">This clone has local work that is not on any remote; removing it deletes the work.</p>${list('Uncommitted', c.dirty ?? [])}${list('Unpushed commits', c.unpushed ?? [])}` : '')
            + (done ? '' : `<p class="pl-note">◇ Review the source and files above. Plugin code runs in this Hyper process with full access once mounted; migrations it runs are not undone by rollback.</p><div class="pl-actions pl-confirm">${form(confirm, `Confirm ${verb.toLowerCase()}`, true)}<a class="pl-button pl-secondary" href="${self}">Cancel</a></div>`)
            + (done && c.status === 'applied' && c.operation !== 'remove' ? `<p><a class="pl-back" href="/plugins/${encodeURIComponent(c.name)}">Open ${esc(c.name)}</a></p>` : '')
            + `<p><a class="pl-back" href="${self}">Back to catalog</a></p></section>`;
        return head + err + body + '</div>';
    }

    let cat: Awaited<ReturnType<typeof ctx.fns.plugins.catalog>> | null = null;
    let notices: string[] = [];
    try { cat = await ctx.fns.plugins.catalog({ ...(opts.q ? { q: opts.q } : {}) }); notices = cat.errors; }
    catch (e) { notices = [e instanceof Error ? e.message : 'Listing unavailable']; }
    const mount = cat?.mount ?? null;
    const locked = mount ? (await ctx.fns.plugins.lockFile({}).catch(() => null))?.lock.plugins ?? {} : {};
    const cards = (cat?.plugins ?? []).map(e => {
        const state = e.installed ? `Installed ${e.installed}` : e.tag ? 'Installed' : e.providedBy ? `Provided by ${e.providedBy}` : 'Not installed';
        const actions = !mount || e.providedBy ? ''
            : e.tag ? (e.update ? form({ operation: 'install', name: e.name }, `Update to ${e.latest}`, true) : '') + form({ operation: 'remove', name: e.name }, 'Remove')
                : e.latest ? form({ operation: 'install', name: e.name }, 'Review install', true) : '';
        return `<article class="pl-card"><div class="pl-icon" aria-hidden="true">${icon(e.icon)}</div><div class="pl-body"><div class="pl-title"><h2>${e.tag ? `<a href="/plugins/${encodeURIComponent(e.name)}">${esc(e.label)}</a>` : esc(e.label)}</h2>${e.latest ? `<span class="pl-badge">${esc(e.latest)}</span>` : ''}<span class="pl-badge">${esc(state)}</span>${e.update ? '<span class="pl-badge">Update available</span>' : ''}</div><p class="pl-description">${esc(e.description)}</p><div class="pl-meta"><span>${esc(e.source)}</span>${(cat?.urls.length ?? 0) > 1 ? `<span>from ${esc(e.listing)}</span>` : ''}${e.requires?.length ? `<span>requires ${esc(e.requires.join(', '))}</span>` : ''}${e.error ? `<span>${esc(e.error)}</span>` : ''}</div></div><div class="pl-actions">${actions}</div></article>`;
    }).join('');
    const listed = new Set((cat?.plugins ?? []).map(p => p.name));
    const extra = opts.q ? '' : Object.keys(locked).filter(n => !listed.has(n)).map(n =>
        `<article class="pl-card"><div class="pl-icon" aria-hidden="true">⊞</div><div class="pl-body"><div class="pl-title"><h2>${esc(n)}</h2><span class="pl-badge">Installed · not in the catalog</span></div><div class="pl-meta"><code>${esc(locked[n]!.repo)}#${esc(locked[n]!.tag)}</code></div></div><div class="pl-actions">${form({ operation: 'remove', name: n }, 'Remove')}</div></article>`).join('');
    const search = `<form method="GET" action="/plugins/listing" class="pl-search" role="search">${opts.embed ? '<input type="hidden" name="embed" value="1">' : ''}<input type="search" name="q" value="${esc(opts.q ?? '')}" placeholder="Search plugins: charts, sql, diagrams…" aria-label="Search plugins"><button class="pl-button" type="submit">Search</button></form>`;
    return head + err + search
        + (!mount ? '<p class="pl-alert" role="status">USER_PLUGINS is not configured; set it to a folder (e.g. ~/.hyper/user) to install from the catalog.</p>' : '')
        + (notices.length ? `<details class="pl-origin"><summary>${notices.length} catalog notice${notices.length === 1 ? '' : 's'}</summary><ul>${notices.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>` : '')
        + `<div class="pl-section-head"><h2>${opts.q ? 'Search results' : 'Available'} · ${cat?.plugins.length ?? 0}</h2><span class="pl-origin">${(cat?.urls ?? []).length} listing${(cat?.urls ?? []).length === 1 ? '' : 's'}</span></div><div class="pl-list">${cards || `<p class="pl-empty">${opts.q ? 'No plugin matches this search.' : 'The catalog is empty.'}</p>`}</div>`
        + (extra ? `<section class="pl-section"><h2>Installed from elsewhere</h2><div class="pl-list">${extra}</div></section>` : '')
        + `<p class="pl-note">◇ Listings (setting plugins.listings, first wins on a name): ${(cat?.urls ?? []).map(u => `<code>${esc(u)}</code>`).join(', ') || 'none'}.</p>`
        + `<p class="pl-note">◇ Installed into <code>${esc(mount ?? 'not set')}</code> as git clones. Releases are vX.Y.Z tags of each plugin repository; the lock file pins the commit, bun installs npm dependencies with scripts disabled. Plugins a plugin requires are installed with it.</p></div>`;
}
