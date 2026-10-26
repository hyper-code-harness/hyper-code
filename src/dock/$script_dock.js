// The Dock's own editing: right click for hide / move / pin / reset — no drag, the order is the default
// one. Moves happen in place (entries keep their live scripts), then the new
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
        // The fixed buttons (menu circle, pin, panel) have no context menu: everything they offer is a click.
        if (e.target.closest('[data-dock-fixed]')) return;
        e.preventDefault();
        const item = e.target.closest('.dock-item[data-dock-id]');
        const names = labels();
        const entries = [];
        if (item) {
            const id = item.dataset.dockId;
            const inTop = item.parentElement?.id === 'dock-top';
            const kind = item.dataset.dockPinned;
            if (kind) entries.push({ icon: 'ph-push-pin-slash', label: 'Unpin ' + (names[id] || id), run: () => { item.remove(); pin(kind, id.slice(kind.length + 1), false); } });
            else entries.push({ icon: 'ph-eye-slash', label: 'Hide ' + (names[id] || id), run: () => { const h = hidden(); h.push(id); item.remove(); save({ hidden: h }); } });
            entries.push({ icon: inTop ? 'ph-arrow-line-down' : 'ph-arrow-line-up', label: inTop ? 'Move to bottom' : 'Move to top', run: () => { (inTop ? zone('bottom') : zone('top'))?.appendChild(item); save(); } });
            entries.push('-');
        }
        for (const id of hidden()) entries.push({ icon: 'ph-eye', label: 'Show ' + (names[id] || id), run: async () => { await save({ hidden: hidden().filter(x => x !== id) }); location.reload(); } });
        const here = location.pathname + location.search;
        const pinnedHere = !!document.querySelector(`#dock [data-dock-id="${CSS.escape('page:' + here)}"]`);
        const agentHere = /^\/agent\/([A-Za-z0-9_-]+)$/.exec(location.pathname)?.[1];
        if (agentHere && !document.querySelector(`#dock [data-dock-id="agent:${CSS.escape(agentHere)}"]`)) entries.push({ icon: 'ph-push-pin', label: 'Pin this chat', run: () => pin('agent', agentHere, true) });
        else if (!agentHere && !pinnedHere) entries.push({ icon: 'ph-push-pin', label: 'Pin this page', run: () => pin('page', here, true) });
        entries.push({ icon: 'ph-arrow-counter-clockwise', label: 'Reset Dock', run: reset });
        open(e.clientX + 2, e.clientY + 2, entries);
    });

    // ── theme switch (delegated, so it survives a Dock refresh) ──────────────
    function paintTheme() {
        const button = document.getElementById('theme-toggle');
        if (!button) return;
        const dark = document.documentElement.dataset.theme === 'dark';
        button.setAttribute('aria-pressed', String(dark));
        if (!button.closest('[popover]')) button.title = dark ? 'Use light theme' : 'Use dark theme';
        const icon = button.querySelector('i');
        if (icon) { icon.classList.remove('ph-sun', 'ph-moon'); icon.classList.add(dark ? 'ph-sun' : 'ph-moon'); }
        const name = button.querySelector('[data-theme-name], .w-row-hint');
        if (name) name.textContent = dark ? 'Dark' : 'Light';
    }
    document.addEventListener('click', e => {
        if (!e.target.closest?.('#theme-toggle')) return;
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        try { localStorage.setItem('hyper-theme', next); } catch (_) {}
        paintTheme();
    });

    // ── refresh after a pin changes (HX-Trigger dock-refresh, or the dock.changed event) ──
    let refreshing = false;
    async function refresh() {
        if (refreshing || document.querySelector('#dock :popover-open')) return;
        refreshing = true;
        try {
            const res = await fetch('/dock', { cache: 'no-store' });
            if (!res.ok) return;
            const current = dock();
            if (!current) return;
            const tpl = document.createElement('template');
            tpl.innerHTML = (await res.text()).trim();
            const next = tpl.content.querySelector('#dock');
            if (!next) return;
            next.querySelectorAll('script').forEach(s => s.remove());
            current.replaceWith(next);
            window.htmx?.process?.(next);
            setup();
        } catch (_) { /* the next change retries */ } finally { refreshing = false; }
    }
    window.hyperDock = { refresh, pin };
    document.body.addEventListener('dock-refresh', refresh);
    window.hyperLive.subscribe({ name: 'dock', types: ['dock.changed'], onEvent: refresh, resync: refresh });

    async function pin(kind, target, pinned = true) {
        const res = await fetch('/dock/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, target, pinned }) });
        if (!res.ok) { window.toast?.({ level: 'error', message: 'Could not change the Dock' }); return; }
        refresh();
        document.body.dispatchEvent(new CustomEvent('nav-refresh'));
    }

    // ── mode: bar (icons) → menu (with labels) → dot (only the menu circle), per device; ⌘B / Ctrl+B cycles ──
    const MODES = ['bar', 'menu', 'dot'];
    const mode = () => document.documentElement.dataset.dockMode || 'bar';
    function paintMode() {
        const next = mode();
        document.querySelectorAll('[data-action="toggle-dock-panel"]').forEach(b => b.setAttribute('aria-pressed', String(next === 'menu')));
        document.querySelectorAll('[data-action="toggle-dock-pin"]').forEach(b => { b.title = next === 'dot' ? 'Pin the bar' : 'Collapse the bar into the circle'; b.setAttribute('aria-label', b.title); });
    }
    function setMode(next) {
        if (!MODES.includes(next)) next = 'bar';
        if (next === 'bar') delete document.documentElement.dataset.dockMode; else document.documentElement.dataset.dockMode = next;
        try { localStorage.setItem('hyper-dock-mode', next); } catch (_) {}
        document.body.dispatchEvent(new CustomEvent('dock-mode', { detail: { mode: next } }));
        paintMode();
        if (next === 'menu') loadPanel();
    }
    // The side panel (projects, recent chats) is fetched the first time it is shown, then lives on the agents topic.
    function loadPanel() {
        const panel = document.getElementById('dock-panel');
        if (!panel) return;
        // Empty: fetch it (htmx's own load trigger covers a page that opens in menu mode; this covers a switch).
        if (!panel.firstElementChild) panel.dispatchEvent(new Event('dock-panel-load'));
        markCurrent();
    }
    function markCurrent() {
        const here = /^\/agent\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
        document.querySelectorAll('#dock-panel [data-dock-panel-chat]').forEach(a => {
            if (a.dataset.dockPanelChat === here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
    }
    document.addEventListener('htmx:after:swap', markCurrent);
    document.addEventListener('htmx:afterSwap', markCurrent);
    window.addEventListener('popstate', markCurrent);
    document.addEventListener('click', e => {
        const b = e.target.closest?.('[data-action="toggle-dock-pin"]');
        if (!b) return;
        e.preventDefault();
        setMode(mode() === 'dot' ? 'bar' : 'dot');
        b.blur();
    });
    // A live refresh must not throw the panel out of its edit mode.
    document.addEventListener('hyper-live', e => {
        if (e.target?.id === 'dock-panel' && e.target.querySelector('[data-dock-panel-edit="true"]')) e.stopImmediatePropagation();
    }, true);
    document.addEventListener('click', e => { if (e.target.closest?.('[data-action="toggle-dock-panel"]')) { e.preventDefault(); setMode(mode() === 'menu' ? 'bar' : 'menu'); } });
    document.addEventListener('click', e => { if (e.target.closest?.('#dock [data-action="open-global-menu"]')) { e.preventDefault(); window.__navOpen?.(); } });
    document.addEventListener('click', e => { const b = e.target.closest?.('[data-dock-mode-set]'); if (b) { e.preventDefault(); setMode(b.dataset.dockModeSet); } });
    window.hyperDockMode = { get: mode, set: setMode };
    document.addEventListener('keydown', e => {
        if (e.key.toLowerCase() !== 'b' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing) return;
        if (!dock()) return;
        e.preventDefault();
        setMode(MODES[(MODES.indexOf(mode()) + 1) % MODES.length]);
    });
    // Another browser tab changed the mode: follow it.
    window.addEventListener('storage', e => { if (e.key === 'hyper-dock-mode') setMode(e.newValue || 'bar'); });

    // The settings gear carries a dot while the update badge inside its popover is visible.
    function paintUpdate() {
        const badge = document.getElementById('hyper-update-badge');
        const dot = document.querySelector('#dock [data-dock-settings-dot]');
        if (dot) dot.hidden = !badge || badge.hidden;
    }
    document.addEventListener('htmx:after:swap', paintUpdate);
    document.addEventListener('htmx:afterSwap', paintUpdate);

    const setup = () => { paintMode(); paintTheme(); paintUpdate(); if (mode() === 'menu') loadPanel(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
