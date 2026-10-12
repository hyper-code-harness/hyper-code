// Canvas beside the chat: open/close, drag the chat width, follow other tabs of the same chat.
// The agent page root ([data-page="agent"]) carries data-canvas-open and --chat-w; CSS in ui.layout
// does the rest, so toggling never re-renders the chat (drafts, scroll, streaming stay put).
(() => {
    if (window.__hyperCanvasInstalled) return;
    window.__hyperCanvasInstalled = true;
    const MIN_CHAT = 320, MIN_CANVAS = 360;
    const page = () => document.querySelector('[data-page="agent"][data-canvas-agent]');
    const agentOf = root => root?.getAttribute('data-canvas-agent') || '';

    // Keep the conversation pinned to the bottom across a reflow, if it was there.
    const keepBottom = fn => {
        const messages = document.getElementById('messages');
        const atBottom = messages && messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
        fn();
        if (atBottom) requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    };
    const paintButtons = root => {
        const open = root.hasAttribute('data-canvas-open');
        root.querySelectorAll('[data-canvas-toggle="toggle"]').forEach(b => {
            b.setAttribute('aria-pressed', String(open));
            b.title = open ? 'Close canvas' : 'Open canvas';
            b.setAttribute('aria-label', b.title);
        });
    };
    const apply = (root, state) => {
        if (!root) return;
        keepBottom(() => {
            if (typeof state.open === 'boolean') root.toggleAttribute('data-canvas-open', state.open);
            if (state.chatWidth) root.style.setProperty('--chat-w', `${state.chatWidth}px`);
            if (!root.hasAttribute('data-canvas-open')) root.removeAttribute('data-canvas-meta-open');
        });
        paintButtons(root);
    };
    const save = (root, body) => fetch(`/canvas/${encodeURIComponent(agentOf(root))}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.ok ? r.json() : null).then(state => state && apply(root, state)).catch(() => {});
    const setOpen = (root, open) => { apply(root, { open }); save(root, { open }); };

    // Tabs changed (opened, switched, closed, retitled, state — here, in another page, or by the agent):
    // fetch the panel again. Only the latest request may swap, and when the active body is unchanged the
    // live one is kept (the framed file keeps its scroll and unsaved edits) and only the strip changes.
    let refreshing = 0;
    const refreshPanel = async root => {
        const ticket = ++refreshing;
        const r = await fetch(`/canvas/${encodeURIComponent(agentOf(root))}/panel`, { headers: { accept: 'text/html' } }).catch(() => null);
        if (!r?.ok || ticket !== refreshing) return;
        const html = await r.text();
        if (ticket !== refreshing) return;
        const panel = root.querySelector(':scope > [data-canvas-panel]');
        if (!panel) return;
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const next = tpl.content.querySelector('[data-canvas-panel]');
        if (!next || next.getAttribute('data-canvas-rev') === panel.getAttribute('data-canvas-rev')) return;
        const oldBody = panel.querySelector('[data-canvas-body]');
        const newBody = next.querySelector('[data-canvas-body]');
        if (oldBody && newBody && oldBody.getAttribute('data-canvas-body-rev') === newBody.getAttribute('data-canvas-body-rev')) newBody.replaceWith(oldBody);
        panel.replaceWith(next);
        window.htmx?.process?.(next);
    };
    const shownRev = root => root.querySelector(':scope > [data-canvas-panel]')?.getAttribute('data-canvas-rev') || '';
    const tabAction = (root, body) => fetch(`/canvas/${encodeURIComponent(agentOf(root))}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.ok ? r.json() : null).then(state => {
        if (!state) return;
        apply(root, state);
        // Usually the canvas.changed event already refreshed; this covers a page without the event stream.
        if (state.rev && state.rev !== shownRev(root)) refreshPanel(root);
    }).catch(() => {});

    document.addEventListener('click', event => {
        const root = page();
        if (!root) return;
        const select = event.target.closest?.('[data-canvas-select]');
        if (select && root.contains(select)) {
            event.preventDefault();
            const tab = select.closest('[data-canvas-tab]');
            if (tab?.hasAttribute('aria-current')) return;
            tabAction(root, { activeItemId: Number(select.getAttribute('data-canvas-select')) });
            return;
        }
        const closeItem = event.target.closest?.('[data-canvas-close-item]');
        if (closeItem && root.contains(closeItem)) {
            event.preventDefault();
            tabAction(root, { closeItemId: Number(closeItem.getAttribute('data-canvas-close-item')) });
            return;
        }
        const toggle = event.target.closest?.('[data-canvas-toggle]');
        if (toggle && root.contains(toggle)) {
            event.preventDefault();
            const mode = toggle.getAttribute('data-canvas-toggle');
            setOpen(root, mode === 'open' ? true : mode === 'close' ? false : !root.hasAttribute('data-canvas-open'));
            return;
        }
        // With the canvas open the inspector is forced to a strip; its toggle then peeks it open
        // over the layout without touching the remembered collapsed state.
        const meta = event.target.closest?.('[data-agent-meta-toggle]');
        if (meta && root.hasAttribute('data-canvas-open') && root.contains(meta)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            root.toggleAttribute('data-canvas-meta-open');
        }
    }, true);

    const clampWidth = (root, width) => {
        const chat = document.getElementById('chat-panel');
        const meta = root.querySelector('[data-agent-meta-panel]');
        const total = root.getBoundingClientRect().width - (meta?.getBoundingClientRect().width ?? 0);
        return Math.round(Math.max(MIN_CHAT, Math.min(width, total - MIN_CANVAS, 1600)) || chat?.getBoundingClientRect().width || 440);
    };
    document.addEventListener('pointerdown', event => {
        const handle = event.target.closest?.('[data-canvas-resizer]');
        const root = page();
        if (!handle || !root) return;
        event.preventDefault();
        const chat = document.getElementById('chat-panel');
        const right = chat.getBoundingClientRect().right;
        handle.setPointerCapture(event.pointerId);
        root.classList.add('canvas-resizing');
        let width = 0;
        const move = e => { width = clampWidth(root, right - e.clientX); root.style.setProperty('--chat-w', `${width}px`); };
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            root.classList.remove('canvas-resizing');
            if (width) save(root, { chatWidth: width });
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });
    document.addEventListener('keydown', event => {
        const handle = event.target.closest?.('[data-canvas-resizer]');
        const root = page();
        if (!handle || !root || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const current = document.getElementById('chat-panel').getBoundingClientRect().width;
        const width = clampWidth(root, current + (event.key === 'ArrowLeft' ? 32 : -32));
        root.style.setProperty('--chat-w', `${width}px`);
        save(root, { chatWidth: width });
    });

    // Another tab (or the agent) changed this chat's canvas: follow it.
    document.addEventListener('hyper-events', event => {
        const ev = event.detail;
        if (ev?.type !== 'canvas.changed') return;
        const root = page();
        if (!root || agentOf(root) !== ev.agentId) return;
        apply(root, ev);
        // The event follows every committed change (ours too), so it alone drives the refresh.
        if (ev.rev && ev.rev !== shownRev(root)) refreshPanel(root);
    });
    const init = () => { const root = page(); if (root) paintButtons(root); };
    document.addEventListener('htmx:after:swap', init);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
