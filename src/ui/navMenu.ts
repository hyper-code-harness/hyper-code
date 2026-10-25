// The global menu (⌘/). Server/HTMX-owned, fetched on every open (not on page load): GET /nav/items draws the current tab's widget grid while the
// box is empty and grouped search results once the person types (see nav.home / nav.searchAll). The frame,
// the box, tab switching and keys live here; widgets and search sources come from `$widget_` / `$search_`.
/** Renders the global navigation dialog: search box, tab strip and widget grid (from GET /nav/items), and its keyboard handling. */
export default function (_ctx: Context, _session: Session | null, _opts?: {}): string {
    return `<div id="nav-overlay" class="hidden fixed inset-0 z-50 bg-base-content/35 p-3 backdrop-blur-[1px]" onclick="if(event.target===this)window.__navClose()">
  <div role="dialog" aria-modal="true" aria-label="Global menu" class="flex h-full w-full flex-col overflow-hidden rounded-xl border border-ui-border bg-base-100 text-base-content shadow-2xl">
    <div class="nav-search flex items-center gap-3 border-b border-ui-border px-4">
      <i class="ph ph-magnifying-glass text-base text-faint" aria-hidden="true"></i>
      <input id="nav-q" name="q" placeholder="Search chats, projects, plugins, people…" autocomplete="off"
             hx-get="/nav/items" hx-trigger="nav-refresh from:body, input changed delay:250ms" hx-target="#nav-results" hx-include="#nav-tab, #nav-edit" hx-sync="this:replace"
             class="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-base-content outline-none placeholder:text-faint">
      <input type="hidden" id="nav-tab" name="tab" value="">
      <input type="hidden" id="nav-edit" name="edit" value="">
      <kbd class="kbd kbd-xs">esc</kbd>
    </div>
    <div id="nav-results" class="min-h-0 flex-1 overflow-y-auto"><div class="px-4 py-5 text-sm text-faint">loading…</div></div>
    <div class="flex gap-4 border-t border-ui-border bg-base-200 px-4 py-1.5 text-3xs text-subtle">
      <span>↑↓ ⌃J/⌃K move</span><span>←→ ⌃H/⌃L column</span><span>⌘←/⌘→ widget</span><span>↵ open</span><span>⌘↵ beside</span><span>⌘1–9 tab</span><span class="ml-auto">⌘/ open</span>
    </div>
  </div>
</div>
<script>
(function () {
  let sel = 0;
  const overlay = () => document.getElementById('nav-overlay');
  const query = () => document.getElementById('nav-q');
  const rows = () => Array.from(document.querySelectorAll('#nav-results .nav-row')).filter(row => !row.closest('details:not([open])') && !row.closest('[hidden]'));
  // Projects widget (master–detail): the project under the selection shows its chats; the choice is remembered.
  const projectsBox = () => document.querySelector('#nav-results [data-nav-projects]');
  const showProject = id => {
    const box = projectsBox();
    if (!box) return '';
    if (!box.querySelector('[data-nav-project-panel="' + CSS.escape(id) + '"]')) id = box.querySelector('[data-nav-project-panel]')?.getAttribute('data-nav-project-panel') || '';
    box.querySelectorAll('[data-nav-project-panel]').forEach(p => { p.hidden = p.getAttribute('data-nav-project-panel') !== id; });
    box.querySelectorAll('[data-nav-project-pick]').forEach(b => b.setAttribute('aria-current', String(b.getAttribute('data-nav-project-pick') === id)));
    try { localStorage.setItem('hyper.nav.project', id); } catch {}
    return id;
  };
  const pickProject = (id, focusPanel) => {
    const box = projectsBox();
    if (!box) return;
    id = showProject(id);
    if (focusPanel) {
      const first = box.querySelector('[data-nav-project-panel="' + CSS.escape(id) + '"] .nav-row');
      const index = rows().indexOf(first);
      if (index >= 0) sel = index;
    }
    mark();
  };
  const restoreProject = () => { let id = ''; try { id = localStorage.getItem('hyper.nav.project') || ''; } catch {} pickProject(id, false); };
  const mark = () => rows().forEach((row, index) => {
    const active = index === sel;
    // The keyboard choice is a state (selected: palest blue), not a hover (grey) — docs/ui-design-system.md §3.
    row.toggleAttribute('data-nav-selected', active);
    row.setAttribute('aria-selected', String(active));
    if (active) window.__navSelId = row.getAttribute('data-nav-id') || '';
    if (active) row.scrollIntoView({ block: 'nearest' });
  });
  const move = delta => {
    const list = rows();
    if (!list.length) return;
    sel = (sel + delta + list.length) % list.length;
    // Moving over a project in the Projects widget shows its chats at once.
    const pick = list[sel].getAttribute('data-nav-project-pick');
    if (pick !== null) showProject(pick);
    mark();
  };
  // ⌘← / ⌘→ jump to the previous / next widget tile (or search group), landing on its first row.
  const jump = delta => {
    const list = rows();
    if (!list.length) return;
    const box = row => row.closest('[data-nav-widget],[data-nav-group]');
    const boxes = [...new Set(list.map(box))];
    const at = boxes.indexOf(box(list[sel]));
    const next = boxes[(at + delta + boxes.length) % boxes.length];
    sel = list.findIndex(row => box(row) === next);
    mark();
  };
  // ← / → (Ctrl+H / Ctrl+L): between the two columns of the Projects widget; elsewhere to the previous / next widget.
  const column = delta => {
    const row = rows()[sel];
    const box = projectsBox();
    if (box && row && box.contains(row)) {
      if (delta > 0 && row.hasAttribute('data-nav-project-pick')) { pickProject(row.getAttribute('data-nav-project-pick'), true); return; }
      if (delta < 0 && row.closest('[data-nav-project-panel]')) {
        const id = row.closest('[data-nav-project-panel]').getAttribute('data-nav-project-panel');
        const index = rows().indexOf(box.querySelector('[data-nav-project-pick="' + CSS.escape(id) + '"]'));
        if (index >= 0) { sel = index; mark(); }
        return;
      }
    }
    jump(delta);
  };
  const openSelected = beside => {
    const row = rows()[sel];
    const project = row?.getAttribute('data-nav-project-pick');
    if (project !== null && project !== undefined) { pickProject(project, true); return; }
    const href = row?.getAttribute('href');
    if (!href) return;
    if (beside || row.getAttribute('target') === '_blank') window.open(href, '_blank', 'noopener');
    else location.href = href;
  };
  const tabs = () => Array.from(document.querySelectorAll('#nav-results [data-nav-tab]'));
  const showTab = id => {
    window.__navSelId = '';
    const field = document.getElementById('nav-tab');
    if (!field || !id) return;
    field.value = id;
    try { localStorage.setItem('hyper.nav.tab', id); } catch {}
    document.body.dispatchEvent(new CustomEvent('nav-refresh'));
  };
  try { const saved = localStorage.getItem('hyper.nav.tab'); if (saved) document.getElementById('nav-tab').value = saved; } catch {}
  // nav-tab arrives as an HX-Trigger from POST /nav/layout (a new or moved tab) — show that tab.
  document.body.addEventListener('nav-tab', event => {
    const id = event.detail?.id;
    if (id) showTab(id);
  });
  document.addEventListener('click', event => {
    const toggle = event.target.closest?.('#nav-results [data-nav-edit-toggle]');
    if (toggle) {
      event.preventDefault();
      const field = document.getElementById('nav-edit');
      field.value = field.value === '1' ? '' : '1';
      document.body.dispatchEvent(new CustomEvent('nav-refresh'));
      return;
    }
    const pick = event.target.closest?.('#nav-results [data-nav-project-pick]');
    if (pick) { event.preventDefault(); sel = rows().indexOf(pick); pickProject(pick.getAttribute('data-nav-project-pick'), false); return; }
    const button = event.target.closest?.('#nav-results [data-nav-tab]');
    if (!button) return;
    event.preventDefault();
    showTab(button.getAttribute('data-nav-tab'));
  });
  window.__navIsOpen = () => !!overlay() && !overlay().classList.contains('hidden');
  window.__navOpen = function () {
    sel = 0;
    window.__navSelId = '';
    overlay().classList.remove('hidden');
    mark();
    // The body is fetched on open, never on page load: every open shows the current state (the last body
    // stays on screen until the fresh one swaps in, keeping the selection by data-nav-id).
    document.body.dispatchEvent(new CustomEvent('nav-refresh'));
    setTimeout(() => { query().focus(); query().select(); }, 30);
  };
  window.__navClose = function () {
    const field = document.getElementById('nav-edit');
    if (field) field.value = '';   // the next open fetches without edit controls
    overlay().classList.add('hidden');
    setTimeout(() => document.getElementById('input')?.focus(), 0);
  };
  document.addEventListener('htmx:after:swap', event => {
    if (event.detail?.ctx?.target?.id !== 'nav-results') return;
    restoreProject();
    // Keep the selection on the same row (by data-nav-id) when the body is redrawn, e.g. by a refresh.
    const keep = window.__navSelId;
    const index = keep ? rows().findIndex(row => row.getAttribute('data-nav-id') === keep) : -1;
    sel = index >= 0 ? index : 0;
    mark();
  });
  window.addEventListener('keydown', event => {
    if (!window.__navIsOpen()) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') { event.preventDefault(); window.__navClose(); return; }
    if (event.key === 'ArrowDown' || ((event.metaKey || event.ctrlKey) && key === 'j')) { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || ((event.metaKey || event.ctrlKey) && key === 'k')) { event.preventDefault(); move(-1); return; }
    if ((event.metaKey || event.ctrlKey) && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); jump(event.key === 'ArrowRight' ? 1 : -1); return; }
    // Touch typists: Ctrl+H / Ctrl+L as ← / → (⌘H would hide the window, ⌘L takes the address bar).
    if (event.ctrlKey && !event.metaKey && (key === 'h' || key === 'l')) { event.preventDefault(); column(key === 'l' ? 1 : -1); return; }
    // Bare ← / → move between columns only while the query is empty, so they still edit typed text.
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !query()?.value) { event.preventDefault(); column(event.key === 'ArrowRight' ? 1 : -1); return; }
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
      const tab = tabs()[Number(event.key) - 1];
      if (tab) { event.preventDefault(); showTab(tab.getAttribute('data-nav-tab')); }
      return;
    }
    if (event.key === 'Enter') {
      if (event.target.closest?.('#nav-results form')) return;
      event.preventDefault(); openSelected(event.metaKey || event.ctrlKey);
    }
  }, true);
})();
</script>`;
}
