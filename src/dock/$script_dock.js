// The Dock's own editing: drag entries within and between the two zones, right click for
// hide / move / reset. Moves happen in place (entries keep their live scripts), then the new
// layout is saved for this person. Showing a hidden entry or resetting reloads the page.
(() => {
    if (window.__hyperDockInstalled) return;
    window.__hyperDockInstalled = true;
    const dock = () => document.getElementById('dock');
    const zone = name => document.getElementById('dock-' + name);
    const ids = el => el ? [...el.querySelectorAll(':scope > .dock-item[data-dock-id]')].map(x => x.dataset.dockId) : [];
    const hidden = () => { try { return JSON.parse(dock()?.dataset.dockHidden || '[]'); } catch { return []; } };
    const labels = () => { try { return JSON.parse(dock()?.dataset.dockLabels || '{}'); } catch { return {}; } };
    async function save(extra = {}) {
        const body = { top: ids(zone('top')), bottom: ids(zone('bottom')), hidden: hidden(), ...extra };
        const res = await fetch('/dock/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { window.toast?.({ level: 'error', message: 'Could not save the Dock' }); return null; }
        const saved = await res.json();
        if (dock() && saved.layout) dock().dataset.dockHidden = JSON.stringify(saved.layout.hidden || []);
        return saved;
    }
    async function reset() {
        await fetch('/dock/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: true }) });
        location.reload();
    }

    // ── drag ────────────────────────────────────────────────────────────────
    let dragged = null;
    document.addEventListener('dragstart', e => {
        const item = e.target.closest?.('#dock .dock-item[data-dock-id]');
        if (!item) return;
        dragged = item;
        item.classList.add('opacity-40');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.dockId);
    });
    document.addEventListener('dragover', e => {
        if (!dragged) return;
        const z = e.target.closest?.('#dock .dock-zone');
        if (!z) return;
        e.preventDefault();
        const after = [...z.querySelectorAll(':scope > .dock-item')].filter(x => x !== dragged)
            .find(x => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
        if (after) z.insertBefore(dragged, after); else z.appendChild(dragged);
    });
    document.addEventListener('dragend', () => {
        if (!dragged) return;
        dragged.classList.remove('opacity-40');
        dragged = null;
        save();
    });
    const arm = () => document.querySelectorAll('#dock .dock-item[data-dock-id]').forEach(x => { x.draggable = true; });

    // ── context menu ────────────────────────────────────────────────────────
    let menu = null;
    const close = () => { menu?.remove(); menu = null; };
    function open(x, y, entries) {
        close();
        menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.className = 'fixed z-[60] min-w-44 rounded-lg border border-ui-border bg-base-100 p-1 text-xs shadow-xl';
        for (const entry of entries) {
            if (entry === '-') { const hr = document.createElement('div'); hr.className = 'my-1 border-t border-ui-border'; menu.appendChild(hr); continue; }
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.className = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted hover:bg-base-200 hover:text-base-content';
            b.innerHTML = `<i class="ph ${entry.icon}" aria-hidden="true"></i>`;
            b.append(entry.label);
            b.addEventListener('click', () => { close(); entry.run(); });
            menu.appendChild(b);
        }
        document.body.appendChild(menu);
        menu.style.left = x + 'px';
        menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 8) + 'px';
    }
    document.addEventListener('click', e => { if (menu && !menu.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.addEventListener('contextmenu', e => {
        const bar = e.target.closest?.('#dock');
        if (!bar) return;
        e.preventDefault();
        const item = e.target.closest('.dock-item[data-dock-id]');
        const names = labels();
        const entries = [];
        if (item) {
            const id = item.dataset.dockId;
            const inTop = item.parentElement?.id === 'dock-top';
            entries.push({ icon: 'ph-eye-slash', label: 'Hide ' + (names[id] || id), run: () => { const h = hidden(); h.push(id); item.remove(); save({ hidden: h }); } });
            entries.push({ icon: inTop ? 'ph-arrow-line-down' : 'ph-arrow-line-up', label: inTop ? 'Move to bottom' : 'Move to top', run: () => { (inTop ? zone('bottom') : zone('top'))?.appendChild(item); save(); } });
            entries.push('-');
        }
        for (const id of hidden()) entries.push({ icon: 'ph-eye', label: 'Show ' + (names[id] || id), run: async () => { await save({ hidden: hidden().filter(x => x !== id) }); location.reload(); } });
        entries.push({ icon: 'ph-arrow-counter-clockwise', label: 'Reset Dock', run: reset });
        open(e.clientX + 2, e.clientY + 2, entries);
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm); else arm();
    document.addEventListener('htmx:after:swap', arm);
})();
