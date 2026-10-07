// Keeps the left-rail @mentions badge live and toasts a new mention of the person in this tab.
(() => {
    if (window.__hyperMentionsInstalled) return;
    window.__hyperMentionsInstalled = true;
    let pending = false, again = false;
    async function refresh() {
        if (pending) { again = true; return; }
        const badge = document.getElementById('mentions-badge');
        if (!badge) return;
        // Never yank an open popup from under the reader.
        if (badge.querySelector(':popover-open')) return;
        pending = true;
        try {
            const res = await fetch('/mentions/badge', { cache: 'no-store' });
            if (res.ok) {
                const html = await res.text();
                const current = document.getElementById('mentions-badge');
                if (current && current.outerHTML !== html) { current.outerHTML = html; window.htmx?.process?.(document.getElementById('mentions-badge')); }
            }
        } catch { /* the next event retries */ } finally {
            pending = false;
            if (again) { again = false; refresh(); }
        }
    }
    const me = () => document.querySelector('[data-me]')?.getAttribute('data-me') || '';
    document.addEventListener('hyper-events', event => {
        const ev = event.detail;
        if (ev?.type !== 'mentions.changed') return;
        const mine = me();
        if (mine && Array.isArray(ev.to) && !ev.to.includes(mine)) return;
        refresh();
        // A new mention in another chat than the one on screen: say so once.
        if (ev.agentId && ev.agentId !== document.body.dataset.agentId && mine && ev.to?.includes(mine)) {
            window.toast?.({ level: 'info', message: 'You were mentioned', html: `<a class="underline" href="/agent/${encodeURIComponent(ev.agentId)}">open chat ${ev.agentId}</a>` });
        }
    });
    document.addEventListener('htmx:after:swap', event => { if (event.detail?.ctx?.target?.id === 'main') refresh(); });
})();
