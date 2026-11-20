// Global chat commands (keys are bound in src/keys/$keymap_default.ts, dispatched by /keys/keys.js):
// chat.nextUnread opens the next unread chat; chat.jumpBack returns through this tab's chat jump
// history; chat.scrollDown/Up scroll the conversation; nav.open opens the global menu.
// The global menu owns its keys while it is open (it handles them first).
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

    const messages = () => document.querySelector('#chat-panel #messages');
    const scroll = dir => { const m = messages(); m?.scrollBy({ top: dir * Math.max(160, m.clientHeight * 0.7), behavior: 'auto' }); };
    const closed = () => !window.__navIsOpen?.();
    const commands = (window.hyperCommands ??= {});
    commands['nav.open'] = { title: 'Open the global menu', group: 'nav', run: () => window.__navOpen?.(), when: () => typeof window.__navOpen === 'function' };
    commands['chat.nextUnread'] = { title: 'Next unread chat', group: 'chat', run: () => void nextUnread(), when: closed };
    commands['chat.jumpBack'] = { title: 'Back through jumped chats', group: 'chat', run: jumpBack, when: closed };
    commands['chat.scrollDown'] = { title: 'Scroll the conversation down', group: 'chat', run: () => scroll(1), when: () => closed() && !!messages() };
    commands['chat.scrollUp'] = { title: 'Scroll the conversation up', group: 'chat', run: () => scroll(-1), when: () => closed() && !!messages() };
    // Escape in the composer leaves it, so the page keys (?, bare-key commands) work again; an open
    // @mention list keeps its own Escape (it closes the list first).
    const composer = () => { const el = document.activeElement; return el?.id === 'input' && el.closest('#chat-panel') ? el : null; };
    const mentionOpen = () => [...document.querySelectorAll('#chat-panel [data-mention-list]')].some(el => !el.hidden);
    commands['chat.focus'] = { title: 'Go to the message box', group: 'chat', run: () => document.querySelector('#chat-panel #input')?.focus(), when: () => !composer() && !!document.querySelector('#chat-panel #input') };
    commands['chat.blur'] = { title: 'Leave the message box', group: 'chat', run: () => composer()?.blur(), when: () => !!composer() && !mentionOpen() };
})();

// Right-click menus (w.menu with contextOf): a right-click inside the element the menu names opens that menu at
// the pointer, kept inside the window. With a text selection the browser's own menu stays. A menu item
// { action: "copy-text" } copies the text of the element ([data-copy-text] inside it, without [data-no-copy]).
(() => {
    if (window.__hyperContextMenusInstalled) return;
    window.__hyperContextMenusInstalled = true;
    const owner = new WeakMap();
    document.addEventListener('contextmenu', e => {
        if (String(window.getSelection?.() ?? '').trim()) return;
        let found = null;
        for (const menu of document.querySelectorAll('.w-menu[data-context-of]')) {
            let host = null;
            try { host = e.target.closest?.(menu.dataset.contextOf); } catch { continue; }
            // The nearest owner wins (a message inside a message keeps its own menu).
            if (host && (!found || found.host.contains(host))) found = { menu, host };
        }
        if (!found || found.menu.contains(e.target)) return;
        e.preventDefault();
        document.querySelectorAll('.w-menu[data-context-of]:popover-open').forEach(m => m.hidePopover());
        const { menu, host } = found;
        owner.set(menu, host);
        menu.style.margin = '0';
        menu.style.left = '0px'; menu.style.top = '0px';
        menu.showPopover();
        const w = menu.offsetWidth || 180, h = menu.offsetHeight || 110;
        menu.style.left = Math.max(8, Math.min(e.clientX, innerWidth - w - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - h - 8)) + 'px';
    });
    document.addEventListener('click', e => {
        // Native popovers usually light-dismiss, but do not rely on that for menus opened by a
        // context click or an htmx swap. Keep the opener exempt so its own click can toggle it.
        if (e.target instanceof Element && !e.target.closest('.w-menu')) {
            const opener = e.target.closest('[popovertarget]');
            document.querySelectorAll('.w-menu:popover-open').forEach(menu => {
                if (opener?.getAttribute('popovertarget') !== menu.id) menu.hidePopover();
            });
        }
        const item = e.target.closest?.('.w-menu[data-context-of] .w-menu-item');
        if (!item) return;
        const menu = item.closest('.w-menu');
        if (item.dataset.action === 'reload-canvas-tab') {
            const host = owner.get(menu);
            const tab = host?.querySelector('[data-canvas-tab]');
            const panel = host?.closest('[data-canvas-panel]');
            const reload = () => panel?.querySelector('[data-canvas-reload]')?.click();
            if (tab && panel && !tab.hasAttribute('aria-current')) {
                // Select the clicked tab first; canvas.js asynchronously swaps its body.
                const id = tab.getAttribute('data-canvas-tab');
                const selected = () => document.querySelector('[data-canvas-panel] [data-canvas-body]')?.getAttribute('data-canvas-item') === id;
                const observer = new MutationObserver(() => {
                    if (!selected()) return;
                    observer.disconnect();
                    document.querySelector('[data-canvas-panel] [data-canvas-reload]')?.click();
                });
                observer.observe(panel.parentElement, { childList: true, subtree: true });
                setTimeout(() => observer.disconnect(), 10000);
                tab.click();
                if (selected()) {
                    observer.disconnect();
                    reload();
                }
            } else reload();
        }
        if (item.dataset.action === 'copy-text') {
            const host = owner.get(menu);
            const text = (host?.querySelector('[data-copy-text]') ?? host)?.cloneNode(true);
            text?.querySelectorAll('[data-no-copy], .w-menu, button').forEach(n => n.remove());
            navigator.clipboard?.writeText((text?.innerText ?? '').trim()).catch(() => {});
        }
        // A delete then shows its confirm dialog; the menu closes either way.
        setTimeout(() => menu.matches(':popover-open') && menu.hidePopover(), 0);
    });
    document.addEventListener('scroll', e => {
        if (e.target instanceof Element && e.target.closest('.w-menu')) return;
        document.querySelectorAll('.w-menu[data-context-of]:popover-open').forEach(m => m.hidePopover());
    }, true);
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
