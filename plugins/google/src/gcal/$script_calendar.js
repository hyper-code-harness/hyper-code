// Google Calendar day page (/gcal/): one day, every event as a card with its details inline.
// On the canvas (embed=1) the date is the tab state: reported up on change, followed when the agent sets it.
(function () {
    const init = window.__gcalInit || {}, root = document.getElementById('gcal');
    if (!root || root.dataset.ready) return; root.dataset.ready = '1';
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const pad = n => String(n).padStart(2, '0');
    const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const tm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
    const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
    const isUrl = x => /^https?:\/\//.test(x || '');
    let cur = init.date ? parseYmd(init.date) : today(), data = null;

    const dur = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' мин' : (m % 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин' : m / 60 + ' ч'); };
    const text = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
    const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => '<a href="' + u + '" target="_blank" rel="noopener">' + (u.length > 60 ? u.slice(0, 60) + '…' : u) + '</a>');
    const answer = { accepted: 'принято', tentative: 'может быть', needsAction: 'нет ответа', declined: 'отклонено' };
    const mark = { accepted: '✓', tentative: '?', needsAction: '·', declined: '✗' };

    function card(e) {
        const s = e.allDay ? null : new Date(e.start), en = e.allDay ? null : new Date(e.end), now = new Date();
        const state = e.allDay ? '' : en < now ? ' past' : s <= now ? ' now' : '';
        const desc = text(e.description);
        const people = e.attendees || [];
        return '<article class="gd-ev' + state + '" style="--c:' + esc(e.color) + '">' +
            '<div class="gd-time">' + (e.allDay ? 'весь день' : '<b>' + tm(s) + '</b><span>' + tm(en) + '</span><small>' + dur(en - s) + '</small>') + '</div>' +
            '<div class="gd-body"><h2>' + esc(e.summary) + (state === ' now' ? ' <em>идёт сейчас</em>' : '') + '</h2>' +
            '<div class="gd-meta">' + esc(e.calendar) + (e.organizer ? ' · организатор ' + esc(e.organizer) : '') + (e.responseStatus ? ' · ' + esc(answer[e.responseStatus] || e.responseStatus) : '') + '</div>' +
            (e.location ? '<div class="gd-row">📍 ' + (isUrl(e.location) ? '<a href="' + esc(e.location) + '" target="_blank" rel="noopener">' + esc(e.location.length > 70 ? e.location.slice(0, 70) + '…' : e.location) + '</a>' : esc(e.location)) + '</div>' : '') +
            (people.length ? '<details class="gd-row"><summary>👥 ' + people.length + ' участн. — ' + esc(people.slice(0, 4).map(a => a.name || a.email.split('@')[0]).join(', ')) + (people.length > 4 ? '…' : '') + '</summary><ul>' +
                people.map(a => '<li class="' + esc(a.responseStatus) + '">' + (mark[a.responseStatus] || '') + ' ' + esc(a.name ? a.name + ' <' + a.email + '>' : a.email) + (a.organizer ? ' (орг.)' : '') + '</li>').join('') + '</ul></details>' : '') +
            (desc ? '<details class="gd-row"' + (desc.length < 300 ? ' open' : '') + '><summary>📝 Описание</summary><div class="gd-desc">' + linkify(desc.slice(0, 4000)) + '</div></details>' : '') +
            '<div class="gd-acts">' + (e.meetLink ? '<a class="p" href="' + esc(e.meetLink) + '" target="_blank" rel="noopener">Подключиться</a>' : '') +
            (e.htmlLink ? '<a href="' + esc(e.htmlLink) + '" target="_blank" rel="noopener">Открыть в Google</a>' : '') + '</div></div></article>';
    }

    function render() {
        const t = ymd(today()), k = ymd(cur);
        $('gc-title').textContent = cur.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + (k === t ? ' · сегодня' : k === ymd(addDays(today(), 1)) ? ' · завтра' : k === ymd(addDays(today(), -1)) ? ' · вчера' : '');
        if (!data) { $('gc-main').innerHTML = '<div class="gd-empty">Загрузка…</div>'; return; }
        const evs = data.events.filter(e => e.calendarPrimary || e.calendarOwn);
        const errs = (data.errors || []).map(e => '<div class="gd-err">' + esc(e.account + (e.calendar ? ' / ' + e.calendar : '') + ': ' + e.error) + '</div>').join('');
        const busy = evs.filter(e => !e.allDay).reduce((n, e) => n + (new Date(e.end) - new Date(e.start)), 0);
        $('gc-main').innerHTML = errs + (evs.length ? '<div class="gd-sum">' + evs.length + ' событ. · занято ' + dur(busy) + '</div>' + evs.map(card).join('') : '<div class="gd-empty">Нет событий</div>');
    }

    async function load() {
        const k = ymd(cur); data = null; render();
        try {
            const r = await fetch('/gcal/api/events?from=' + encodeURIComponent(cur.toISOString()) + '&to=' + encodeURIComponent(addDays(cur, 1).toISOString())).then(r => r.json());
            if (r.error) throw new Error(r.error);
            if (k !== ymd(cur)) return;
            const own = new Map(r.calendars.map(c => [c.account + '|' + c.id, c]));
            for (const e of r.events) { const c = own.get(e.account + '|' + e.calendarId); e.calendarPrimary = !!c?.primary; e.calendarOwn = !!c?.owner && /@group\.calendar\.google\.com$/.test(c.id); }
            data = r; render();
        } catch (err) { $('gc-main').innerHTML = '<div class="gd-err">Ошибка: ' + esc(err.message) + '</div>'; }
    }

    const inCanvas = init.embed && window.parent !== window;
    const report = () => { if (inCanvas) window.parent.postMessage({ hyperCanvas: 1, type: 'state', state: { date: ymd(cur) } }, location.origin); };
    if (inCanvas) window.addEventListener('message', ev => {
        const m = ev.data; if (ev.source !== window.parent || !m || m.hyperCanvas !== 1 || m.type !== 'state' || !m.state) return;
        const d = m.state.date; if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== ymd(cur)) { cur = parseYmd(d); load(); }
    });
    function go(d) { cur = d; load(); report(); if (!init.embed) { const u = new URL(location.href); u.searchParams.set('date', ymd(cur)); history.replaceState(null, '', u); } }
    root.addEventListener('click', ev => { const a = ev.target.closest('[data-act]')?.dataset.act; if (a) go(a === 'today' ? today() : addDays(cur, a === 'next' ? 1 : -1)); });
    document.addEventListener('keydown', ev => {
        if (ev.target.closest?.('input,textarea') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
        if (ev.key === 'ArrowRight') go(addDays(cur, 1)); else if (ev.key === 'ArrowLeft') go(addDays(cur, -1)); else if (ev.key === 't') go(today());
    });
    setInterval(() => { if (!document.hidden) load(); }, 5 * 60_000);
    load(); report();
})();
