// Pure-render helper for the declared-settings htmx form.
// Used by both GET (full page) and POST (re-render after save).
function esc(s: any): string {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function renderInput(item: any): string {
    const d = item.descriptor;
    const cur = item.currentValue;
    const name = `${item.module}.${item.key}`;
    const isSecret = d.type === 'secret';
    if (d.type === 'enum' && Array.isArray(d.options)) {
        const opts = d.options.map((o: any) => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
        return `<select name="${esc(name)}" class="px-2 py-1 border border-ui-border rounded text-xs font-mono">${opts}</select>`;
    }
    if (d.type === 'boolean') {
        return `<input type="checkbox" name="${esc(name)}" value="true"${cur ? ' checked' : ''} class="align-middle">`;
    }
    if (d.type === 'number') {
        const min = d.min != null ? ` min="${esc(d.min)}"` : '';
        const max = d.max != null ? ` max="${esc(d.max)}"` : '';
        return `<input type="number"${min}${max} name="${esc(name)}" value="${esc(cur ?? '')}" class="px-2 py-1 border border-ui-border rounded text-xs font-mono w-32">`;
    }
    if (d.type === 'text') {
        return `<textarea name="${esc(name)}" rows="3" class="w-full px-2 py-1 border border-ui-border rounded text-xs font-mono">${esc(cur ?? '')}</textarea>`;
    }
    const display = isSecret && cur ? '••••••••' + String(cur).slice(-4) : (cur ?? '');
    const placeholder = isSecret ? `placeholder="${esc(display)}"` : '';
    const value = isSecret ? '' : `value="${esc(cur ?? '')}"`;
    return `<input type="${isSecret ? 'password' : 'text'}" name="${esc(name)}" ${value} ${placeholder} class="px-2 py-1 border border-ui-border rounded text-xs font-mono w-72">`;
}

function renderRow(ctx: Context, item: any): string {
    const d = item.descriptor;
    const sourceBadge = item.source === 'db' ? '<span class="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">db</span>'
        : item.source === 'env' ? `<span class="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">env: ${esc(d.env)}</span>`
        : '<span class="text-xs px-1.5 py-0.5 rounded bg-base-200 text-subtle border border-ui-border">default</span>';
    const resetBtn = item.source === 'db'
        ? ctx.fns.procs.ui.button({ action: 'reset-setting', label: 'reset', name: 'reset', value: item.module + '.' + item.key, size: 'xs' })
        : '';
    return `<tr class="border-b border-base-200">
  <td class="px-3 py-2 align-top">
    <div class="font-mono text-xs text-muted">${esc(item.key)}</div>
    ${d.title ? `<div class="text-xs text-subtle">${esc(d.title)}</div>` : ''}
    ${d.description ? `<div class="text-2xs text-faint mt-0.5">${esc(d.description)}</div>` : ''}
  </td>
  <td class="px-3 py-2 align-top">${renderInput(item)}</td>
  <td class="px-3 py-2 align-top">${sourceBadge}</td>
  <td class="px-3 py-2 align-top text-xs text-faint font-mono">${esc(JSON.stringify(d.default))}</td>
  <td class="px-3 py-2 align-top">${resetBtn}</td>
</tr>`;
}

/** Renders the declared-settings form as an HTML fragment. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<string> {
    const items = await ctx.fns.settings.declared({});
    const byModule = new Map<string, any[]>();
    for (const it of items) {
        if (!byModule.has(it.module)) byModule.set(it.module, []);
        byModule.get(it.module)!.push(it);
    }
    const sections = [...byModule.entries()].map(([mod, rows]) => `
<section class="mb-6">
  <h2 class="text-sm font-semibold text-muted mb-2">${esc(mod)}</h2>
  <table class="w-full text-sm border border-ui-border rounded">
    <thead class="bg-base-200 text-xs text-subtle">
      <tr><th class="text-left px-3 py-2">key</th><th class="text-left px-3 py-2">value</th><th class="text-left px-3 py-2">source</th><th class="text-left px-3 py-2">default</th><th></th></tr>
    </thead>
    <tbody>
      ${rows.map(item => renderRow(ctx, item)).join('\n')}
    </tbody>
  </table>
</section>`).join('\n');

    return `<form id="settings-form"
      class="px-6 py-4 max-w-4xl"
      hx-post="/settings/declared"
      hx-target="this"
      hx-swap="outerHTML">
  ${sections || '<div class="text-sm text-subtle">No <code>$setting_*.ts</code> declarations found.</div>'}
  ${items.length ? ctx.fns.procs.ui.button({ action: 'save-settings', label: 'Save changes', type: 'submit' }) : ''}
</form>`;
}
