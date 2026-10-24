// Canvas beside the chat: open/close, drag the chat width, follow other tabs of the same chat.
// The agent page root ([data-page="agent"]) carries data-canvas-open and --chat-w; CSS in ui.layout
// does the rest, so toggling never re-renders the chat (drafts, scroll, streaming stay put).
(() => {
    if (window.__hyperCanvasInstalled) return;
    window.__hyperCanvasInstalled = true;
    const MIN_CHAT = 320, MIN_CANVAS = 360;
    const page = () => document.querySelector('[data-page="agent"][data-canvas-agent]');
    const agentOf = root => root?.getAttribute('data-canvas-agent') || '';
    // The key lives here only (CHAT_KEY), so it can move into a shared key table later. Mac: ⌘\, else Ctrl+\.
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const CHAT_KEY = { key: '\\', meta: MAC, ctrl: !MAC };
    const CHAT_KEY_LABEL = MAC ? '⌘\\' : 'Ctrl+\\';
    const isChatKey = e => e && e.key === CHAT_KEY.key && !!e.metaKey === CHAT_KEY.meta && !!e.ctrlKey === CHAT_KEY.ctrl && !e.altKey && !e.shiftKey;

    // Keep the conversation pinned to the bottom across a reflow, if it was there.
    const keepBottom = fn => {
        const messages = document.getElementById('messages');
        const atBottom = messages && messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
        fn();
        if (atBottom) requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    };
    const paintButtons = root => {
        const open = root.hasAttribute('data-canvas-open');
        const collapsed = root.hasAttribute('data-chat-collapsed');
        root.querySelectorAll('[data-canvas-chat-toggle]').forEach(b => {
            b.setAttribute('aria-pressed', String(collapsed));
            b.title = (collapsed ? 'Expand chat' : 'Collapse chat') + ' — ' + CHAT_KEY_LABEL;
            b.setAttribute('aria-label', b.title);
        });
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
            if (typeof state.chatCollapsed === 'boolean') root.toggleAttribute('data-chat-collapsed', state.chatCollapsed && root.hasAttribute('data-canvas-open'));
            if (!root.hasAttribute('data-canvas-open')) root.removeAttribute('data-chat-collapsed');
            if (state.chatWidth) root.style.setProperty('--chat-w', `${state.chatWidth}px`);
        });
        paintButtons(root);
    };
    const save = (root, body) => fetch(`/canvas/${encodeURIComponent(agentOf(root))}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.ok ? r.json() : null).then(state => state && apply(root, state)).catch(() => {});
    const setOpen = (root, open) => { apply(root, { open }); save(root, { open }); };

    // ── command canvas.toggleChat: fold the chat into a strip over the canvas and back ──────────────
    const commands = (window.hyperCommands ??= {});
    // The work is the header button's htmx post (the server flips the row, canvas.changed redraws every page of
    // the chat); the command and the key only press it.
    commands['canvas.toggleChat'] = {
        title: 'Collapse/expand chat column', group: 'canvas/window', keys: CHAT_KEY_LABEL,
        run: () => {
            const button = [...(page()?.querySelectorAll('[data-canvas-chat-toggle]') ?? [])].find(b => b.offsetParent !== null)
                ?? page()?.querySelector('[data-canvas-chat-toggle]');
            if (!button || button.disabled) return false;
            button.click();
            return true;
        },
    };
    document.addEventListener('keydown', e => {
        if (!isChatKey(e) || !page()) return;
        e.preventDefault();
        commands['canvas.toggleChat'].run();
    });

    // Tabs changed (opened, switched, closed, retitled, state — here, in another page, or by the agent):
    // fetch the panel again. Only the latest request may swap, and when the active body is unchanged the
    // live one is kept (the framed file keeps its scroll and unsaved edits) and only the strip changes.
    let refreshing = 0;
    // `given` is a panel the server already sent (the answer of a tab action), so no second request is made.
    const refreshPanel = async (root, force = false, given = null) => {
        const ticket = ++refreshing;
        let html = given;
        if (html == null) {
            const r = await fetch(`/canvas/${encodeURIComponent(agentOf(root))}/panel`, { headers: { accept: 'text/html' } }).catch(() => null);
            if (!r?.ok || ticket !== refreshing) return;
            html = await r.text();
        }
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
            // A view tab may bring a live region (a `@live` view): the event stream must watch its topic.
            document.dispatchEvent(new CustomEvent('hyper:regions'));
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
    // ── theme: a sandboxed frame (html tab, srcdoc app) cannot read the page's theme, so it is told ─────
    // on load and on every switch. Its own document starts from the system preference (canvas.htmlFrame).
    const themeFrames = () => [...document.querySelectorAll('[data-canvas-body] iframe[data-canvas-frame], [data-canvas-body] iframe[srcdoc]')];
    const sendTheme = frame => {
        const theme = document.documentElement.dataset.theme;
        if (theme === 'dark' || theme === 'light') frame.contentWindow?.postMessage({ hyperCanvas: 1, type: 'theme', theme }, '*');
    };
    document.addEventListener('load', event => {
        if (event.target instanceof HTMLIFrameElement && themeFrames().includes(event.target)) sendTheme(event.target);
    }, true);
    new MutationObserver(() => themeFrames().forEach(sendTheme)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── url tabs: with the canvas-frames extension the framed site reports where it is now ─────────
    // (extensions/canvas-frames/frame.js). The address bar follows it and the tab remembers the address
    // in its state, so a reload opens the same page. Trusted by source window: a url tab's frame here.
    window.addEventListener('message', event => {
        const msg = event.data;
        if (!msg || msg.hyperFrames !== 1 || msg.type !== 'location') return;
        const root = page();
        const frame = root && [...root.querySelectorAll('[data-canvas-body][data-canvas-kind="url"] iframe[data-canvas-url-frame]')].find(f => f.contentWindow === event.source);
        if (!frame) return;
        let url;
        try { url = new URL(String(msg.url)); } catch { return; }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
        const body = frame.closest('[data-canvas-body]');
        const itemId = body?.getAttribute('data-canvas-item');
        const form = body?.querySelector('[data-canvas-navigate]');
        if (!itemId || !form) return;
        const input = form.querySelector('input[name="url"]');
        if (input && document.activeElement !== input) input.value = url.href;
        form.querySelectorAll('a[target="_blank"]').forEach(a => { a.href = url.href; });
        const seen = url.href + '\n' + String(msg.title || '');
        if (frame.getAttribute('data-canvas-url-at') === seen) return;
        frame.setAttribute('data-canvas-url-at', seen);
        fetch(`/canvas/${encodeURIComponent(agentOf(root))}/item/${encodeURIComponent(itemId)}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state: { url: url.href, title: String(msg.title || '').slice(0, 200) || null, from: form.getAttribute('data-canvas-url-from') } }),
        }).catch(() => {});
    });

    window.addEventListener('message', event => {
        const msg = event.data;
        if (!msg || msg.hyperCanvas !== 1) return;
        // A key pressed inside a framed tab (htmlFrame bridge): the page's own commands still work there.
        if (msg.type === 'key') {
            const root = page();
            const own = root && [...root.querySelectorAll('[data-canvas-body] iframe')].some(f => f.contentWindow === event.source);
            if (own && isChatKey(msg)) commands['canvas.toggleChat'].run();
            return;
        }
        const root = page();
        const frame = root && [...root.querySelectorAll('[data-canvas-body] iframe')].find(f => f.contentWindow === event.source);
        if (!frame) return;
        const body = frame.closest('[data-canvas-body]');
        const itemId = frame.getAttribute('data-canvas-frame') || body?.getAttribute('data-canvas-item');
        if (!itemId) return;
        // A page framed by a view (rpc.frame) moves its tab to the same view with other params: a new address,
        // with history. In a tab of an older kind the params are its state, as before.
        if (msg.type === 'navigate' && msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) {
            const fn = frame.closest('[data-rpc-view]')?.getAttribute('data-rpc-view');
            if (body?.getAttribute('data-canvas-kind') === 'view' && fn) {
                tabAction(root, { navigate: { itemId: Number(itemId), ...(msg.replace === true ? { replace: true } : {}), url: `/rpc/${fn}?${encodeURIComponent(JSON.stringify(msg.params))}` } });
                return;
            }
            msg.type = 'state'; msg.state = msg.params;
        }
        if (!frame.hasAttribute('data-canvas-frame')) return;
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
    // A tab action (select, close, navigate, back/forward) is ONE request: the answer carries the new panel,
    // its view fragment already drawn on the server. While it is in flight the canvas.changed event of the
    // same change is not followed (it would fetch the panel a second time).
    let acting = 0;
    // The body shows it is loading (canvas.css: faded content, a running bar) until the answer is drawn.
    const busy = (root, on) => root.querySelector('[data-canvas-body]')?.toggleAttribute('aria-busy', on);
    const tabAction = (root, body) => {
        acting++;
        busy(root, true);
        return fetch(`/canvas/${encodeURIComponent(agentOf(root))}`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-canvas-panel': '1' }, body: JSON.stringify(body),
        }).then(r => r.ok ? r.json() : null).then(state => {
            if (!state) return;
            apply(root, state);
            // The busy mark stays until the new body is in the page: an answer without the panel (an older
            // server) fetches it first, so the old body never shows again between the click and the new one.
            if (typeof state.panel === 'string') return refreshPanel(root, false, state.panel);
            if (state.rev && state.rev !== shownRev(root)) return refreshPanel(root);
        }).catch(() => {}).finally(() => { if (!--acting) busy(root, false); });
    };

    document.addEventListener('click', event => {
        const root = page();
        if (!root) return;
        // The whole tab selects it, except its close button.
        const tab = event.target.closest?.('[data-canvas-tab]');
        if (tab && root.contains(tab) && !event.target.closest('[data-canvas-close-item]')) {
            event.preventDefault();
            if (tab.hasAttribute('aria-current')) return;
            // Show the choice at once; the panel with its body follows in the one answer.
            const ON = ['bg-base-100', 'text-base-content'], OFF = ['border-b', 'bg-base-300/60', 'text-muted', 'hover:bg-base-300'];
            root.querySelectorAll('[data-canvas-tab][aria-current]').forEach(t => { t.removeAttribute('aria-current'); t.classList.remove(...ON); t.classList.add(...OFF); });
            tab.setAttribute('aria-current', 'true'); tab.classList.remove(...OFF); tab.classList.add(...ON);
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
        // ◀ ▶ of a view tab: step through the addresses this tab has shown (canvas.navigate history).
        const step = event.target.closest?.('[data-canvas-step]');
        if (step && root.contains(step)) {
            event.preventDefault();
            const form = step.closest('[data-canvas-navigate]');
            if (form) tabAction(root, { navigate: { itemId: Number(form.getAttribute('data-canvas-navigate')), history: step.getAttribute('data-canvas-step') } });
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
    }, true);

    const clampWidth = (root, width) => {
        const chat = document.getElementById('chat-panel');
        const total = root.getBoundingClientRect().width;
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
            // The event follows every committed change; our own tab actions bring their panel themselves.
            if (acting) return;
            if (ev.rev && ev.rev !== shownRev(root)) refreshPanel(root);
        },
        resync: catchUp,
    });
    // ── Links: where a click opens (docs/canvas-links.md) ──────────────────────────────────────────
    // One target table for the chat and the tabs: a /rpc/<fn>?<json> address is a view tab, a Files address
    // (/files/absolute|embed|remote/…) a file tab, an http(s) site a url tab; any other Hyper page has no
    // canvas kind and goes to a new browser tab, so the chat is never navigated away.
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
    const canvasTarget = href => {
        let u;
        try { u = new URL(href, location.href); } catch { return null; }
        if (u.origin === location.origin) {
            if (u.pathname.startsWith('/rpc/')) return { kind: 'view', args: { url: u.pathname + u.search } };
            const file = filesTarget(u.href);
            return file ? { kind: 'file', args: file } : null;
        }
        return /^https?:$/.test(u.protocol) ? { kind: 'url', args: { url: u.href } } : null;
    };
    // How the person asked: the link's own data-canvas-open ("here" | "replace" | "tab" | "browser") wins,
    // target=_blank means the browser, Cmd/Ctrl or the middle button a new canvas tab, a plain click "here".
    const howOpen = (event, a) => {
        const forced = a.getAttribute('data-canvas-open');
        if (forced === 'here' || forced === 'replace' || forced === 'tab' || forced === 'browser') return forced;
        if (a.target === '_blank') return 'browser';
        return event.button === 1 || event.metaKey || event.ctrlKey ? 'tab' : 'here';
    };
    const openBrowser = href => window.open(new URL(href, location.href).href, '_blank', 'noopener');
    // A new canvas tab (or the open one with the same address). A site that forbids framing, in a browser
    // without the frames extension, would only show a notice: the server answers { browser } and it opens there.
    const showTab = (root, show, href) => {
        const ask = show.kind === 'url' && !document.documentElement.hasAttribute('data-hyper-frames') ? { ...show, fallback: 'browser' } : show;
        acting++;
        busy(root, true);
        return fetch(`/canvas/${encodeURIComponent(agentOf(root))}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-canvas-panel': '1' }, body: JSON.stringify({ show: ask }) })
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(state => {
                if (state.browser) { openBrowser(state.browser); return; }
                apply(root, state);
                if (typeof state.panel === 'string') return refreshPanel(root, false, state.panel);
                if (state.rev && state.rev !== shownRev(root)) return refreshPanel(root);
            })
            .catch(() => openBrowser(href))
            .finally(() => { if (!--acting) busy(root, false); });
    };
    const plainHref = a => {
        const href = a.getAttribute('href') || '';
        return !href || href.startsWith('#') || /^(javascript|mailto|tel|data|blob):/i.test(href) || a.hasAttribute('download') ? null : href;
    };

    // In the chat: a plain click opens the link as a canvas tab (or switches to the tab already showing it).
    // A modifier or middle click keeps the browser's own behaviour, and so does a link with no canvas kind.
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const a = event.target.closest?.('#chat-panel .prose a[href]');
        const root = page();
        if (!a || !root || a.target === '_blank' || a.getAttribute('data-canvas-open') === 'browser') return;
        const href = plainHref(a);
        const show = href && canvasTarget(href);
        if (!show) return;
        event.preventDefault();
        showTab(root, show, href);
    });

    // Inside a tab (a view's fragment, the Files viewer): a plain click moves this tab and adds a history step;
    // data-canvas-open="replace" moves it without one; Cmd/Ctrl/middle click opens a new canvas tab; an outside
    // site opens a new canvas tab even on a plain click (it is not this tab's kind of address); target=_blank
    // and data-canvas-open="browser" go to a new browser tab. Shift/Alt clicks stay the browser's.
    const onTabLink = event => {
        if (event.defaultPrevented || event.shiftKey || event.altKey || (event.button !== 0 && event.button !== 1)) return;
        const a = event.target.closest?.('[data-canvas-body] a[href]');
        const root = page();
        if (!a || !root || !root.contains(a)) return;
        const href = plainHref(a);
        if (!href) return;
        const how = howOpen(event, a);
        if (how === 'browser' && a.target === '_blank') return;
        event.preventDefault();
        const target = canvasTarget(href);
        if (how === 'browser' || !target) { openBrowser(href); return; }
        const body = a.closest('[data-canvas-body]');
        const itemId = Number(body?.getAttribute('data-canvas-item'));
        const kind = body?.getAttribute('data-canvas-kind');
        // A view tab takes /rpc and Files addresses in place; a tab of the older file kind only other files.
        const inPlace = itemId && (kind === 'view' ? target.kind !== 'url' : kind === 'file' && target.kind === 'file');
        if ((how === 'here' || how === 'replace') && inPlace) {
            const replace = how === 'replace' ? { replace: true } : {};
            tabAction(root, { navigate: { itemId, ...replace, ...(target.kind === 'file' ? { file: target.args } : { url: target.args.url }) } });
            return;
        }
        showTab(root, target, href);
    };
    document.addEventListener('click', onTabLink);
    document.addEventListener('auxclick', event => { if (event.button === 1) onTabLink(event); });
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
