// Compact global menu prototype. It remains server/HTMX-owned: the default
// overview and filtered results both come from GET /nav/items.
/** Performs the ui.navMenu runtime operation. */
export default function (_ctx: Context, _session: Session | null, _opts?: {}): string {
    return `<div id="nav-overlay" class="hidden fixed inset-0 z-50 bg-base-content/35 p-3 backdrop-blur-[1px]" onclick="if(event.target===this)window.__navClose()">
  <div role="dialog" aria-modal="true" aria-label="Global menu" class="flex h-full w-full flex-col overflow-hidden rounded-xl border border-ui-border bg-base-100 text-base-content shadow-2xl">
    <div class="flex items-center gap-3 border-b border-ui-border px-4">
      <i class="ph ph-magnifying-glass text-base text-faint" aria-hidden="true"></i>
      <input id="nav-q" name="q" placeholder="Search chats, projects, plugins, people…" autocomplete="off"
             hx-get="/nav/items" hx-trigger="load, palette-open, nav-refresh from:body, input changed delay:100ms" hx-target="#nav-results"
             class="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-base-content outline-none placeholder:text-faint">
      <kbd class="kbd kbd-xs">esc</kbd>
    </div>
    <div id="nav-results" class="min-h-0 flex-1 overflow-y-auto"></div>
    <div class="flex gap-4 border-t border-ui-border bg-base-200 px-4 py-1.5 text-3xs text-subtle">
      <span>⌘J/⌘K move</span><span>↵ open</span><span>⌘↵ beside</span><span class="ml-auto">⌘/ open</span>
    </div>
  </div>
</div>
<script>
(function () {
  let sel = 0;
  const overlay = () => document.getElementById('nav-overlay');
  const query = () => document.getElementById('nav-q');
  const rows = () => Array.from(document.querySelectorAll('#nav-results .nav-row'));
  const mark = () => rows().forEach((row, index) => {
    const active = index === sel;
    row.classList.toggle('bg-base-200', active);
    row.classList.toggle('text-base-content', active);
    row.classList.toggle('ring-1', active);
    row.classList.toggle('ring-inset', active);
    row.classList.toggle('ring-ui-border-strong', active);
    row.setAttribute('aria-selected', String(active));
    if (active) row.scrollIntoView({ block: 'nearest' });
  });
  const move = delta => {
    const list = rows();
    if (!list.length) return;
    sel = (sel + delta + list.length) % list.length;
    mark();
  };
  const openSelected = beside => {
    const row = rows()[sel];
    const href = row?.getAttribute('href');
    if (!href) return;
    if (beside) window.open(href, '_blank', 'noopener');
    else location.href = href;
  };
  window.__navIsOpen = () => !!overlay() && !overlay().classList.contains('hidden');
  window.__navOpen = function () {
    sel = 0;
    overlay().classList.remove('hidden');
    if (window.htmx) window.htmx.trigger(query(), 'palette-open');
    setTimeout(() => { query().focus(); query().select(); }, 30);
  };
  window.__navClose = function () {
    overlay().classList.add('hidden');
    setTimeout(() => document.getElementById('input')?.focus(), 0);
  };
  document.addEventListener('htmx:after:swap', event => {
    if (event.detail?.ctx?.target?.id === 'nav-results') { sel = 0; mark(); }
  });
  window.addEventListener('keydown', event => {
    if (!window.__navIsOpen()) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') { event.preventDefault(); window.__navClose(); return; }
    if (event.key === 'ArrowDown' || ((event.metaKey || event.ctrlKey) && key === 'j')) { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || ((event.metaKey || event.ctrlKey) && key === 'k')) { event.preventDefault(); move(-1); return; }
    if (event.key === 'Enter') { event.preventDefault(); openSelected(event.metaKey || event.ctrlKey); }
  }, true);
})();
</script>`;
}
