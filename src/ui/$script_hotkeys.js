// Global keyboard shortcuts. Ctrl+J opens the next unread chat; Ctrl+K
// returns through this tab's chat jump history. ⌘J/⌘K retain chat scrolling.
// The global menu owns both pairs while it is open.
(() => {
    if (window.__hyperAgentHotkeysInstalled) return;
    window.__hyperAgentHotkeysInstalled = true;

    const HISTORY_KEY = 'hyper:chat-jump-history';
    let navigating = false;
    const currentAgentId = () => document.querySelector('#chat-panel')?.dataset.agentId || location.pathname.match(/^\/agent\/([^/]+)/)?.[1] || null;
    const history = () => {
        try { const value = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value.filter(x => typeof x === 'string').slice(-20) : []; }
        catch { return []; }
    };
    const saveHistory = value => sessionStorage.setItem(HISTORY_KEY, JSON.stringify(value.slice(-20)));
    const visit = id => { if (id) location.href = `/agent/${encodeURIComponent(id)}`; };

    async function nextUnread() {
        if (navigating) return;
        navigating = true;
        try {
            const current = currentAgentId();
            const response = await fetch(`/nav/next/unread?current=${encodeURIComponent(current || '')}`, { cache: 'no-store' });
            if (!response.ok) return;
            const { id } = await response.json();
            if (!id || id === current) return;
            const stack = history();
            if (current && stack.at(-1) !== current) stack.push(current);
            saveHistory(stack);
            visit(id);
        } finally { navigating = false; }
    }

    function jumpBack() {
        const current = currentAgentId();
        const stack = history();
        let id;
        while (stack.length && (!id || id === current)) id = stack.pop();
        saveHistory(stack);
        visit(id);
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === '/' && !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            window.__navOpen?.();
            return;
        }

        if (event.isComposing || event.altKey || event.shiftKey) return;
        if (window.__navIsOpen?.()) return;

        const key = event.key.toLowerCase();
        if (key !== 'j' && key !== 'k') return;

        if (event.metaKey && !event.ctrlKey) {
            const messages = document.querySelector('#chat-panel #messages');
            if (!messages) return;
            event.preventDefault();
            messages.scrollBy({
                top: (key === 'j' ? 1 : -1) * Math.max(160, messages.clientHeight * 0.7),
                behavior: 'auto',
            });
            return;
        }

        if (!event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        if (key === 'j') void nextUnread();
        else jumpBack();
    });
})();

// Right-click on a message opens its own actions (delete this / from here — drawn by the server next to it);
// a click elsewhere, Escape or a second right-click closes them. Ordinary text selection menus stay the
// browser's: only a right-click on the message bubble itself, without a text selection, is taken.
(() => {
    if (window.__hyperMessageMenuInstalled) return;
    window.__hyperMessageMenuInstalled = true;
    const close = () => document.querySelectorAll('[data-message-menu-open]').forEach(el => el.removeAttribute('data-message-menu-open'));
    document.addEventListener('contextmenu', e => {
        const row = e.target.closest?.('#messages [id^="m-"]');
        if (!row || !row.querySelector('[data-message-menu]') || String(window.getSelection?.() ?? '').trim()) return;
        e.preventDefault();
        close();
        row.setAttribute('data-message-menu-open', '');
        // At the pointer, kept inside the window.
        const menu = row.querySelector('[data-message-menu]');
        const w = menu.offsetWidth || 180, h = menu.offsetHeight || 110;
        row.style.setProperty('--menu-x', Math.min(e.clientX, innerWidth - w - 8) + 'px');
        row.style.setProperty('--menu-y', Math.min(e.clientY, innerHeight - h - 8) + 'px');
        menu.querySelector('.message-menu-item')?.focus({ preventScroll: true });
    });
    document.addEventListener('click', e => {
        const copy = e.target.closest?.('[data-message-copy]');
        if (copy) {
            const bubble = copy.closest('[id^="m-"]')?.querySelector('.chat-glass-primary, .assistant, .w-msg-text');
            const text = bubble?.cloneNode(true);
            text?.querySelectorAll('[data-author], [data-message-menu], button, .sr-only').forEach(n => n.remove());
            navigator.clipboard?.writeText((text?.innerText ?? '').replace(/\s*\d{1,2}:\d{2}\s*$/, '').trim()).catch(() => {});
            close();
            return;
        }
        if (!e.target.closest?.('[data-message-menu]')) close();
        // A chosen delete closes the menu too (its confirm dialog then takes over).
        else if (e.target.closest?.('.message-menu-item')) setTimeout(close, 0);
    });
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();

// The folded chat strip can be dragged by its top edge (the little grip) anywhere over the canvas — e.g. to the
// right side. The place is kept per device (localStorage hyper-strip-pos); a double click on the grip puts it
// back at the bottom centre.
(() => {
    if (window.__hyperStripDragInstalled) return;
    window.__hyperStripDragInstalled = true;
    const strip = () => document.querySelector('[data-page="agent"][data-chat-collapsed] > #chat-panel');
    const onCorner = (el, e) => { const r = el.getBoundingClientRect(); return e.clientY - r.top < 16 && e.clientX - r.left < 16; };
    const onGrip = (el, e) => { const r = el.getBoundingClientRect(); return e.clientY - r.top < 12 && e.clientX < r.right - 48 && !onCorner(el, e); };
    const size = (el, w, h) => {
        w = Math.max(320, Math.min(w, el.parentElement.getBoundingClientRect().width - 16));
        h = Math.max(96, Math.min(h, el.parentElement.getBoundingClientRect().height - 16));
        el.style.setProperty('--strip-w', w + 'px');
        el.style.setProperty('--strip-h', h + 'px');
        el.setAttribute('data-strip-sized', '');
        return { w, h };
    };
    const place = (el, x, y) => {
        const page = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect();
        x = Math.max(8, Math.min(x, page.width - r.width - 8));
        y = Math.max(8, Math.min(y, page.height - r.height - 8));
        el.style.setProperty('--strip-x', x + 'px');
        el.style.setProperty('--strip-y', y + 'px');
        el.setAttribute('data-strip-moved', '');
        return { x, y };
    };
    const restore = () => {
        const el = strip();
        if (!el) return;
        try { const z = JSON.parse(localStorage.getItem('hyper-strip-size') || 'null'); if (z) size(el, z.w, z.h); } catch (_) {}
        try { const p = JSON.parse(localStorage.getItem('hyper-strip-pos') || 'null'); if (p) place(el, p.x, p.y); } catch (_) {}
    };
    // The top-left corner resizes: the right and bottom edges stay where they are.
    document.addEventListener('pointerdown', e => {
        const el = strip();
        if (!el || e.button !== 0 || !el.contains(e.target) || !onCorner(el, e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const page = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect();
        const right = r.right - page.left, bottom = r.bottom - page.top;
        let last = null, pos = null;
        const move = ev => {
            last = size(el, right - (ev.clientX - page.left), bottom - (ev.clientY - page.top));
            pos = place(el, right - last.w, bottom - last.h);
        };
        const up = () => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', up, true);
            try { if (last) localStorage.setItem('hyper-strip-size', JSON.stringify(last)); if (pos) localStorage.setItem('hyper-strip-pos', JSON.stringify(pos)); } catch (_) {}
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
    }, true);
    document.addEventListener('pointerdown', e => {
        const el = strip();
        if (!el || e.button !== 0 || !el.contains(e.target) || !onGrip(el, e)) return;
        e.preventDefault();
        const page = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        let last = null;
        el.style.cursor = 'grabbing';
        const move = ev => { last = place(el, ev.clientX - page.left - dx, ev.clientY - page.top - dy); };
        const up = () => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', up, true);
            el.style.cursor = '';
            if (last) try { localStorage.setItem('hyper-strip-pos', JSON.stringify(last)); } catch (_) {}
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
    });
    document.addEventListener('dblclick', e => {
        const el = strip();
        if (!el || !el.contains(e.target) || !onGrip(el, e)) return;
        el.removeAttribute('data-strip-moved');
        el.removeAttribute('data-strip-sized');
        try { localStorage.removeItem('hyper-strip-pos'); localStorage.removeItem('hyper-strip-size'); } catch (_) {}
    });
    // The strip appears when the chat folds (canvas.js flips the attribute) or after a page swap.
    new MutationObserver(restore).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-chat-collapsed'] });
    document.addEventListener('htmx:after:swap', restore);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore); else restore();
})();

// Unsent text survives leaving the chat: what you type in a chat's composer is kept per chat in this browser
// (localStorage hyper-draft:<agentId>) and put back when you come back — after navigating away, a reload or a
// server restart. A successful send clears it; an empty field removes it.
(() => {
    if (window.__hyperDraftsInstalled) return;
    window.__hyperDraftsInstalled = true;
    const key = id => 'hyper-draft:' + id;
    const agentOf = input => input.closest('#chat-panel')?.dataset.agentId || document.body.dataset.agentId || '';
    const save = input => {
        const id = agentOf(input);
        if (!id) return;
        try { input.value.trim() ? localStorage.setItem(key(id), input.value) : localStorage.removeItem(key(id)); } catch (_) {}
    };
    let timer = 0;
    document.addEventListener('input', e => {
        if (e.target?.id !== 'input' || !e.target.closest('[data-form="chat"]')) return;
        clearTimeout(timer);
        const input = e.target;
        timer = setTimeout(() => save(input), 250);
    });
    // Leaving the page (or the chat via htmx) writes the latest text at once.
    window.addEventListener('pagehide', () => { const i = document.querySelector('[data-form="chat"] #input'); if (i) save(i); });
    document.addEventListener('htmx:before:swap', () => { const i = document.querySelector('[data-form="chat"] #input'); if (i) save(i); }, true);
    // Sent: the form clears the field; forget the draft.
    document.addEventListener('htmx:after:request', e => {
        const form = e.target?.closest?.('[data-form="chat"]');
        const status = e.detail?.ctx?.response?.status ?? e.detail?.xhr?.status ?? 0;
        if (!form || !(status > 0 && status < 400)) return;
        const input = form.querySelector('#input');
        const id = input && agentOf(input);
        if (id) try { localStorage.removeItem(key(id)); } catch (_) {}
    });
    const restore = () => {
        const input = document.querySelector('[data-form="chat"] #input');
        if (!input || input.value) return;
        const id = agentOf(input);
        let text = null;
        try { text = id ? localStorage.getItem(key(id)) : null; } catch (_) {}
        if (!text) return;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.setSelectionRange?.(text.length, text.length);
    };
    document.addEventListener('htmx:after:swap', restore);
    document.addEventListener('htmx:afterSwap', restore);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore); else restore();
})();

// Widget popovers and menus (src/w): the opener's aria-expanded follows the popover, and a w.menu is a real
// menu for the keyboard — focus goes to its first item when it opens, ↑ ↓ Home End move, Escape closes (native).
(() => {
    if (window.__hyperWidgetMenusInstalled) return;
    window.__hyperWidgetMenusInstalled = true;
    document.addEventListener('toggle', e => {
        const pop = e.target;
        if (!(pop instanceof HTMLElement) || !pop.matches('.w-popover, .w-menu')) return;
        const open = e.newState === 'open';
        document.querySelectorAll(`[popovertarget="${CSS.escape(pop.id)}"]`).forEach(b => b.setAttribute('aria-expanded', String(open)));
        if (open && pop.matches('.w-menu')) requestAnimationFrame(() => pop.querySelector('.w-menu-item')?.focus({ preventScroll: true }));
    }, true);
    document.addEventListener('keydown', e => {
        const menu = e.target.closest?.('.w-menu:popover-open');
        if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const items = [...menu.querySelectorAll('.w-menu-item:not([aria-disabled="true"])')];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
    });
})();
