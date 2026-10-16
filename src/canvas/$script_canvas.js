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
    const refreshPanel = async (root, force = false) => {
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
        if (!next || (!force && next.getAttribute('data-canvas-rev') === panel.getAttribute('data-canvas-rev'))) return;
        const oldBody = panel.querySelector('[data-canvas-body]');
        const newBody = next.querySelector('[data-canvas-body]');
        if (force || !oldBody || !newBody || oldBody.getAttribute('data-canvas-body-rev') !== newBody.getAttribute('data-canvas-body-rev')) {
            panel.replaceWith(next);
            runBodyScripts(next);
            window.htmx?.process?.(next);
            return;
        }
        // Same body: change only what is around it. Moving an iframe in the DOM reloads it, so the live
        // body never moves — the framed file keeps scroll and edits, an html page keeps running.
        panel.setAttribute('data-canvas-rev', next.getAttribute('data-canvas-rev') || '');
        const oldHeader = panel.querySelector(':scope > header'), newHeader = next.querySelector(':scope > header');
        if (oldHeader && newHeader) { oldHeader.replaceWith(newHeader); window.htmx?.process?.(newHeader); }
        // A live-state page (html tab) gets the new state posted in instead of a reload.
        const nextState = newBody.getAttribute('data-canvas-state');
        if (nextState !== null && nextState !== oldBody.getAttribute('data-canvas-state')) {
            oldBody.setAttribute('data-canvas-state', nextState);
            pushState(oldBody, nextState);
        }
    };
    // ── html tabs: the sandboxed page talks to us only by postMessage ──────────────────────────────
    // Its origin is opaque, so we trust a message by its source window: it must be the frame of a tab
    // in this panel. State patches go out one at a time per tab, in order. While any are in flight,
    // states arriving from canvas.changed are only our own acknowledgements (or racing with them), so
    // they are not pushed in; when the queue drains, the server's answer is the truth and goes in if it
    // differs from what the page holds. So the page never sees its own write echoed or rolled back.
    const canon = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
    const frames = new WeakMap();   // frame element -> { held: canonical state the page has, pending, chain }
    const frameInfo = frame => { let f = frames.get(frame); if (!f) frames.set(frame, f = { held: null, pending: 0, chain: Promise.resolve() }); return f; };
    const deliver = (frame, state) => {
        const info = frameInfo(frame);
        if (info.held === canon(state)) return;
        info.held = canon(state);
        frame.closest('[data-canvas-body]')?.setAttribute('data-canvas-state', JSON.stringify(state));
        frame.contentWindow?.postMessage({ hyperCanvas: 1, type: 'state', state }, '*');
    };
    const pushState = (body, text) => {
        const frame = body.querySelector('iframe[data-canvas-frame]');
        if (!frame?.contentWindow || frameInfo(frame).pending) return;
        let state = {};
        try { state = JSON.parse(text) || {}; } catch {}
        deliver(frame, state);
    };
    window.addEventListener('message', event => {
        const msg = event.data;
        if (!msg || msg.hyperCanvas !== 1) return;
        const root = page();
        const frame = root && [...root.querySelectorAll('iframe[data-canvas-frame]')].find(f => f.contentWindow === event.source);
        if (!frame) return;
        const itemId = frame.getAttribute('data-canvas-frame');
        const url = `/canvas/${encodeURIComponent(agentOf(root))}/item/${encodeURIComponent(itemId)}`;
        const post = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            .then(async r => { if (!r.ok) console.warn(`canvas tab ${itemId}:`, await r.text()); return r.ok ? r.json() : null; }).catch(() => null);
        if (msg.type === 'state' && msg.state && typeof msg.state === 'object' && !Array.isArray(msg.state)) {
            const info = frameInfo(frame);
            let held = {};
            try { held = JSON.parse(info.held || 'null') || JSON.parse(frame.closest('[data-canvas-body]')?.getAttribute('data-canvas-state') || '{}') || {}; } catch {}
            info.held = canon(Object.fromEntries(Object.entries({ ...held, ...msg.state }).filter(([, v]) => v !== null)));
            info.pending++;
            info.chain = info.chain.then(() => post({ state: msg.state })).then(answer => {
                if (--info.pending) return;
                // Drained: what the server holds wins — a failed write or another page's change shows up here.
                if (answer?.state) deliver(frame, answer.state);
                else fetch(`/canvas/${encodeURIComponent(agentOf(root))}/panel`).then(r => r.ok ? r.text() : '').then(html => {
                    const m = html.match(/data-canvas-state="([^"]*)"/);
                    if (!m || info.pending) return;
                    const t = document.createElement('textarea'); t.innerHTML = m[1];
                    try { deliver(frame, JSON.parse(t.value)); } catch {}
                }).catch(() => {});
            });
        } else if (msg.type === 'ping') {
            post({ ping: { text: String(msg.text ?? ''), data: msg.data } });
        } else if (msg.type === 'error') {
            console.warn(`canvas tab ${itemId}:`, msg.message);
        }
    });
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
        // The whole tab selects it, except its close button.
        const tab = event.target.closest?.('[data-canvas-tab]');
        if (tab && root.contains(tab) && !event.target.closest('[data-canvas-close-item]')) {
            event.preventDefault();
            if (tab.hasAttribute('aria-current')) return;
            tabAction(root, { activeItemId: Number(tab.getAttribute('data-canvas-tab')) });
            return;
        }
        const closeItem = event.target.closest?.('[data-canvas-close-item]');
        if (closeItem && root.contains(closeItem)) {
            event.preventDefault();
            tabAction(root, { closeItemId: Number(closeItem.getAttribute('data-canvas-close-item')) });
            return;
        }
        const reload = event.target.closest?.('[data-canvas-reload]');
        if (reload && root.contains(reload)) {
            event.preventDefault();
            refreshPanel(root, true);
            return;
        }
        const reopen = event.target.closest?.('[data-canvas-reopen]');
        if (reopen && root.contains(reopen)) {
            event.preventDefault();
            reopen.closest('details')?.removeAttribute('open');
            tabAction(root, { reopenItemId: Number(reopen.getAttribute('data-canvas-reopen')) });
            return;
        }
        // A click elsewhere closes the recently-closed menu.
        for (const menu of root.querySelectorAll('[data-canvas-history][open]')) if (!menu.contains(event.target)) menu.removeAttribute('open');
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
        try { handle.setPointerCapture(event.pointerId); } catch {}
        root.classList.add('canvas-resizing');
        let width = 0;
        // Listen on window, not the handle: the handle can be replaced by a re-render mid-drag, and an
        // iframe under the cursor swallows events — either way pointerup was lost and the edge stuck to
        // the cursor. A move with no button pressed also ends the drag.
        const move = e => {
            if (!(e.buttons & 1)) return up();
            width = clampWidth(root, right - e.clientX);
            root.style.setProperty('--chat-w', `${width}px`);
        };
        const up = () => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', up, true);
            window.removeEventListener('blur', up);
            handle.removeEventListener('lostpointercapture', up);
            root.classList.remove('canvas-resizing');
            if (width) save(root, { chatWidth: width });
            width = 0;
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
        window.addEventListener('blur', up);
        handle.addEventListener('lostpointercapture', up);
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

    // Another tab (or the agent) changed this chat's canvas: follow it. After a gap in the event stream
    // (tab hidden on HTTP/1.1, network drop, frozen tab) re-read the canvas instead — the events sent
    // meanwhile are gone. See docs/live-updates.md.
    const catchUp = () => {
        const root = page();
        if (!root) return;
        fetch(`/canvas/${encodeURIComponent(agentOf(root))}/state`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(state => {
                if (!state || page() !== root) return;
                apply(root, state);
                if (state.rev && state.rev !== shownRev(root)) refreshPanel(root);
            }).catch(() => {});
    };
    window.hyperLive.subscribe({
        name: 'canvas',
        types: ['canvas.changed'],
        onEvent: ev => {
            const root = page();
            if (!root || agentOf(root) !== ev.agentId) return;
            apply(root, ev);
            // The event follows every committed change (ours too), so it alone drives the refresh.
            if (ev.rev && ev.rev !== shownRev(root)) refreshPanel(root);
        },
        resync: catchUp,
    });
    // Links in the chat open beside it instead of navigating the page away: a file link (/files/absolute/…,
    // what the markdown renderer makes of a path) becomes a file tab, a web link a url tab. A modifier
    // or middle click keeps the browser's own behaviour, and so does any link the server refuses.
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const a = event.target.closest?.('#chat-panel .prose a[href]');
        const root = page();
        if (!a || !root || a.hasAttribute('download')) return;
        const url = new URL(a.getAttribute('href'), location.href);
        let show = null;
        if (url.origin === location.origin && url.pathname.startsWith('/files/absolute/')) {
            let path = '';
            try { path = '/' + url.pathname.slice('/files/absolute/'.length).split('/').map(decodeURIComponent).join('/'); } catch { return; }
            show = { kind: 'file', args: { path } };
        } else if (url.origin !== location.origin && /^https?:$/.test(url.protocol)) {
            show = { kind: 'url', args: { url: url.href } };
        }
        if (!show) return;
        event.preventDefault();
        fetch(`/canvas/${encodeURIComponent(agentOf(root))}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show }) })
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(state => { apply(root, state); if (state.rev && state.rev !== shownRev(root)) refreshPanel(root); })
            .catch(() => window.open(a.href, '_blank', 'noopener'));
    });

    // A file tab draws the Files viewer in place (files.view), not in a frame. Its links — breadcrumbs,
    // folder entries, Preview/Code/Edit — move this same tab; a modifier click keeps the browser's own
    // behaviour (open the Files page). Raw media and PDF links are left alone.
    const filesTarget = href => {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return null;
        const tab = url.searchParams.get('tab') || '';
        let m;
        try {
            if ((m = /^\/files\/(?:absolute|embed)(\/.*)?$/.exec(url.pathname))) return { path: (m[1] || '/').split('/').map(decodeURIComponent).join('/') || '/', tab };
            if ((m = /^\/files\/remote\/(?:embed\/)?([^/]+)(\/.*)?$/.exec(url.pathname))) return { host: decodeURIComponent(m[1]), path: (m[2] || '/').split('/').map(decodeURIComponent).join('/') || '/', tab };
        } catch { return null; }
        return null;
    };
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const a = event.target.closest?.('[data-canvas-files] a[href]');
        const root = page();
        if (!a || !root || !root.contains(a) || a.hasAttribute('download') || a.target === '_blank') return;
        const target = filesTarget(a.getAttribute('href'));
        if (!target) return;
        const body = a.closest('[data-canvas-body]');
        const itemId = Number(body?.getAttribute('data-canvas-item'));
        if (!itemId) return;
        event.preventDefault();
        tabAction(root, { navigate: { itemId, file: target } });
    });
    // The editor of an Edit view comes as <script> in the body. A refreshed panel is parsed from a template,
    // where scripts are inert, so they are recreated to run (a first page load runs them itself).
    const runBodyScripts = el => {
        el?.querySelectorAll?.('[data-canvas-files] script').forEach(old => {
            const s = document.createElement('script');
            for (const { name, value } of old.attributes) s.setAttribute(name, value);
            s.textContent = old.textContent;
            if (s.src) s.async = false;
            old.replaceWith(s);
        });
    };

    document.addEventListener('focusin', event => {
        if (event.target.matches?.('[data-canvas-navigate] input[name="url"]')) event.target.select();
    });
    // A url tab's address bar: Enter opens the typed address in the same tab (canvas.navigate).
    document.addEventListener('submit', event => {
        const form = event.target.closest?.('[data-canvas-navigate]');
        const root = page();
        if (!form || !root || !root.contains(form)) return;
        event.preventDefault();
        const url = String(new FormData(form).get('url') || '').trim();
        if (!url) return;
        tabAction(root, { navigate: { itemId: Number(form.getAttribute('data-canvas-navigate')), url } });
    });

    const init = () => { const root = page(); if (root) paintButtons(root); };
    document.addEventListener('htmx:after:swap', init);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
