// One disposable controller per #chat-panel. HTMX owns markup; this controller
// owns only local interaction (scroll anchoring, composer keys and lazy tools).
(() => {
    if (window.__hyperChatControllerInstalled) return;
    window.__hyperChatControllerInstalled = true;

    const STICKY_BOTTOM_PX = 48;
    let current = null;

    class ChatController {
        constructor(panel) {
            this.panel = panel;
            this.messages = panel.querySelector('#messages');
            this.form = panel.querySelector('#form');
            this.input = panel.querySelector('#input');
            this.agentId = this.messages?.dataset.agentId || panel.dataset.agentId || '';
            this.fileInput = panel.querySelector('#files');
            this.attachButton = panel.querySelector('[data-attach-button]');
            this.attachmentTray = panel.querySelector('[data-attachments]');
            this.inheritedCount = Number(this.messages?.dataset.inheritedCount || 0);
            this.abort = new AbortController();
            this.shouldStick = true;
            this.historyAnchor = null;
            this.historyAnchorTop = null;
            this.loadingOlder = false;
            this.ownSwaps = new WeakSet();
            this.submitting = false;
            this.lastAssistant = this.latestAssistant();
        }

        // The composer grows with what is typed (up to 40vh, then scrolls). CSS field-sizing does it where
        // supported; elsewhere set the height from the content.
        fit() {
            if (!this.input || CSS.supports?.('field-sizing', 'content')) return;
            this.input.style.height = 'auto';
            this.input.style.height = this.input.scrollHeight + 'px';
        }

        mount() {
            if (!this.messages || !this.form || !this.input) return false;
            const { signal } = this.abort;
            this.messages.addEventListener('scroll', () => {
                // Once the reader leaves the live edge, background swaps must
                // never reclaim the scroll position. Only an explicit send can
                // opt back into automatic positioning.
                if (!this.isNearBottom()) this.shouldStick = false;
                if (this.messages.scrollTop < 80) this.loadOlder();
            }, { passive: true, signal });
            // @mentions: typing @ suggests people; the list owns arrows/Enter/Tab/Esc while open.
            this.input.addEventListener('input', () => { this.mentionUpdate(); this.fit(); }, { signal });
            this.input.addEventListener('blur', () => setTimeout(() => this.mentionClose(), 150), { signal });
            this.input.addEventListener('keydown', (event) => {
                if (event.isComposing || event.key === 'Process') return;
                if (this.mentionKey(event)) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!this.input.value.trim() && !this.fileInput?.files?.length) return;
                    this.form.requestSubmit();
                }
            }, { signal });
            // Copying a piece of the chat copies what was said, not the controls
            // around it: message buttons (Delete message, Delete from here…),
            // their screen-reader labels, icons and tool chips stay out.
            this.messages.addEventListener('copy', event => this.copyClean(event), { signal });
            this.attachButton?.addEventListener('click', () => this.fileInput?.click(), { signal });
            this.fileInput?.addEventListener('change', () => this.renderAttachments(), { signal });
            this.input.addEventListener('paste', event => {
                const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
                if (!files.length) return;
                event.preventDefault();
                const text = event.clipboardData?.getData('text/plain') || '';
                if (text) this.insertText(text);
                this.addFiles(files);
            }, { signal });
            this.form.addEventListener('dragover', event => { event.preventDefault(); this.form.setAttribute('data-drop', ''); }, { signal });
            this.form.addEventListener('dragleave', event => { if (!this.form.contains(event.relatedTarget)) this.form.removeAttribute('data-drop'); }, { signal });
            this.form.addEventListener('drop', event => { event.preventDefault(); this.form.removeAttribute('data-drop'); this.addFiles([...(event.dataTransfer?.files || [])]); }, { signal });
            this.form.addEventListener('submit', event => {
                if (!this.input.value.trim() && !this.fileInput?.files?.length) return event.preventDefault();
                if (this.submitting) return event.preventDefault();
                this.submitting = true;
                const requestId = this.form.elements.requestId;
                if (requestId && !requestId.value) requestId.value = crypto.randomUUID();
                this.shouldStick = true;
            }, { signal });
            this.form.addEventListener('htmx:after:request', event => {
                const ctx = event.detail?.ctx;
                if (ctx?.sourceElement !== this.form) return;
                this.submitting = false;
                if (!(ctx?.response?.status < 400)) return;
                const requestId = this.form.elements.requestId;
                if (requestId) requestId.value = '';
                // Sent: empty the field and the picked files (w.composer has no inline handler for it).
                this.input.value = '';
                if (this.fileInput) this.fileInput.value = '';
                this.input.focus();
                this.shouldStick = true;
                this.scrollBottom();
                this.renderAttachments();
                this.fit();
                requestAnimationFrame(() => { if (this.alive() && this.shouldStick) this.scrollBottom(); });
            }, { signal });
            this.addInheritedNote();
            document.body.dataset.agentId = this.agentId;
            requestAnimationFrame(() => {
                if (!this.alive()) return;
                if (this.jumpToHash()) return;
                this.scrollBottom();
                this.shouldStick = this.isNearBottom();
                this.input.focus();
            });
            return true;
        }


        async mentionPeople() {
            if (!this.peoplePromise) this.peoplePromise = fetch('/mentions/people', { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []);
            return this.peoplePromise;
        }

        // The @word being typed right before the caret, or null.
        mentionQuery() {
            const caret = this.input.selectionStart;
            if (caret !== this.input.selectionEnd) return null;
            const m = /(^|[^\w@.\/-])@([a-z0-9-]{0,64})$/i.exec(this.input.value.slice(0, caret));
            return m ? { start: caret - m[2].length - 1, query: m[2].toLowerCase() } : null;
        }

        async mentionUpdate() {
            const at = this.mentionQuery();
            if (!at) return this.mentionClose();
            const people = await this.mentionPeople();
            if (this.mentionQuery()?.start !== at.start) return;
            const q = at.query;
            const words = p => [p.id, p.name, p.email || ''].join(' ').toLowerCase();
            const list = people
                .filter(p => !q || words(p).split(/[\s@.-]+/).some(w => w.startsWith(q)) || p.id.startsWith(q))
                .slice(0, 8);
            if (!list.length) return this.mentionClose();
            this.mention = { start: at.start, list, sel: Math.min(this.mention?.sel ?? 0, list.length - 1) };
            this.mentionRender();
        }

        mentionRender() {
            let box = this.mentionBox;
            if (!box) {
                box = this.mentionBox = document.createElement('div');
                box.setAttribute('role', 'listbox');
                box.setAttribute('aria-label', 'Mention someone');
                box.dataset.mentionList = '';
                box.className = 'absolute bottom-full left-0 z-30 mb-2 w-72 max-w-full overflow-hidden rounded-xl border border-ui-border bg-base-100 p-1 text-base-content shadow-xl';
                box.addEventListener('mousedown', event => {
                    const row = event.target.closest('[data-mention-id]');
                    if (!row) return;
                    event.preventDefault();
                    this.mentionPick(row.dataset.mentionId);
                });
                (this.input.parentElement || this.form).append(box);
            }
            const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
            box.innerHTML = this.mention.list.map((p, i) => {
                const face = p.picture
                    ? `<img src="${esc(p.picture)}" alt="" class="size-6 shrink-0 rounded-full object-cover" referrerpolicy="no-referrer">`
                    : `<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-base-300 text-3xs font-semibold">${esc((p.name || p.id).slice(0, 1).toUpperCase())}</span>`;
                return `<div role="option" aria-selected="${i === this.mention.sel}" data-mention-id="${esc(p.id)}" class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 ${i === this.mention.sel ? 'bg-base-200' : 'hover:bg-base-200/60'}">${face}<span class="min-w-0 flex-1"><span class="block truncate text-xs font-medium">${esc(p.name)}</span><span class="block truncate text-3xs text-faint">@${esc(p.id)}${p.email ? ' · ' + esc(p.email) : ''}</span></span></div>`;
            }).join('');
            box.hidden = false;
        }

        mentionKey(event) {
            if (!this.mention || !this.mentionBox || this.mentionBox.hidden) return false;
            const n = this.mention.list.length;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                this.mention.sel = (this.mention.sel + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
                this.mentionRender();
                return true;
            }
            if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault();
                this.mentionPick(this.mention.list[this.mention.sel].id);
                return true;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                this.mentionClose();
                return true;
            }
            return false;
        }

        mentionPick(id) {
            if (!this.mention) return;
            const start = this.mention.start, end = this.input.selectionStart;
            this.input.setRangeText('@' + id + ' ', start, end, 'end');
            this.mentionClose();
            this.input.focus();
            this.input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        mentionClose() {
            this.mention = null;
            if (this.mentionBox) this.mentionBox.hidden = true;
        }

        insertText(text) {
            const start = this.input.selectionStart, end = this.input.selectionEnd;
            this.input.setRangeText(text, start, end, 'end');
            this.input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        addFiles(files) {
            if (!this.fileInput || !files.length) return;
            const dt = new DataTransfer();
            for (const file of [...(this.fileInput.files || []), ...files].slice(0, 10)) dt.items.add(file);
            this.fileInput.files = dt.files;
            this.renderAttachments();
        }

        removeFile(index) {
            const dt = new DataTransfer();
            [...(this.fileInput?.files || [])].forEach((file, i) => { if (i !== index) dt.items.add(file); });
            this.fileInput.files = dt.files;
            this.renderAttachments();
        }

        renderAttachments() {
            if (!this.attachmentTray || !this.fileInput) return;
            const files = [...(this.fileInput.files || [])];
            this.attachmentTray.replaceChildren();
            files.forEach((file, index) => {
                const chip = document.createElement('div');
                chip.className = 'w-composer-file';
                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(img.src); chip.append(img);
                } else { const icon = document.createElement('i'); icon.className = 'w-icon ph ph-file'; icon.dataset.size = '16'; chip.append(icon); }
                const name = document.createElement('span'); name.textContent = file.name; chip.append(name);
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'w-icon-button'; remove.dataset.size = '24'; remove.setAttribute('aria-label', 'Remove ' + file.name); remove.innerHTML = '<i class="w-icon ph ph-x" data-size="14" aria-hidden="true"></i>'; remove.addEventListener('click', () => this.removeFile(index), { signal: this.abort.signal }); chip.append(remove);
                this.attachmentTray.append(chip);
            });
        }
        alive() { return current === this && this.panel.isConnected && !this.abort.signal.aborted; }
        isNearBottom() { return this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight <= STICKY_BOTTOM_PX; }
        scrollBottom() { this.messages.scrollTop = this.messages.scrollHeight; }

        latestAssistant() {
            const items = this.messages.querySelectorAll('.w-msg[data-role="agent"]');
            return items[items.length - 1] || null;
        }

        scrollAssistantTop(element) {
            const messagesTop = this.messages.getBoundingClientRect().top;
            const elementTop = element.getBoundingClientRect().top;
            this.messages.scrollTop += elementTop - messagesTop - 12;
        }
        addInheritedNote() {
            if (this.inheritedCount <= 0 || this.messages.querySelector('[data-inherited]')) return;
            const note = document.createElement('div');
            note.className = 'bg-base-200 text-subtle italic rounded-lg px-4 py-3';
            note.dataset.inherited = '1';
            note.textContent = `inherited context: ${this.inheritedCount} msgs`;
            this.messages.prepend(note);
        }

        // /agent/<id>#m-<idx> (a mention link) opens the chat at that message: older pages are loaded
        // until it is in the DOM, then it is scrolled to the middle and flashed.
        jumpToHash() {
            const m = /^#m-(\d+)$/.exec(location.hash);
            if (!m) { this.jumpTarget = null; return false; }
            const el = this.messages.querySelector('#m-' + m[1]);
            if (el) {
                this.jumpTarget = null;
                this.shouldStick = false;
                el.scrollIntoView({ block: 'center' });
                el.classList.add('ring-2', 'ring-primary/60', 'rounded-2xl');
                setTimeout(() => el.classList.remove('ring-2', 'ring-primary/60', 'rounded-2xl'), 2500);
                history.replaceState(history.state, '', location.pathname + location.search);
                return true;
            }
            if (this.jumpTarget === m[1] && !this.messages.querySelector('#msg-head')) { this.jumpTarget = null; return false; }
            this.jumpTarget = m[1];
            const head = this.messages.querySelector('#msg-head');
            if (!head) { this.jumpTarget = null; return false; }
            this.shouldStick = false;
            this.loadingOlder = true;
            htmx.trigger(head, 'load-older');
            return true;
        }

        loadOlder() {
            const head = this.messages.querySelector('#msg-head');
            if (!head || this.loadingOlder) return;
            this.loadingOlder = true;
            this.historyAnchor = head.nextElementSibling;
            this.historyAnchorTop = this.historyAnchor?.getBoundingClientRect().top ?? null;
            htmx.trigger(head, 'load-older');
        }

        beforeSwap(event) {
            const target = event.detail?.ctx?.target;
            const source = event.detail?.ctx?.sourceElement;
            // Ignore late HTMX responses from a chat that has already been
            // replaced by navigation to another agent.
            if (!(target && (target === this.messages || this.panel.contains(target)))
                && !(source && this.panel.contains(source))) return;
            if (target) this.ownSwaps.add(target);
            // Do not infer consent to autoscroll from geometry here: a live
            // fragment can update while the reader happens to be near the end.
            if (target?.id === 'msg-head' && this.messages.contains(target)) {
                this.historyAnchor = target.nextElementSibling;
                this.historyAnchorTop = this.historyAnchor?.getBoundingClientRect().top ?? null;
                this.loadingOlder = true;
            }
        }

        afterSwap(event) {
            if (!this.alive()) return;
            const target = event.detail?.ctx?.target;
            const source = event.detail?.ctx?.sourceElement;
            const belongsHere = (target && (this.ownSwaps.has(target) || target === this.messages || this.panel.contains(target)))
                || (source && this.panel.contains(source));
            if (!belongsHere) return;
            const latestAssistant = this.latestAssistant();
            const hasNewAssistant = latestAssistant && latestAssistant !== this.lastAssistant;
            if (hasNewAssistant && this.shouldStick) {
                this.lastAssistant = latestAssistant;
                this.scrollAssistantTop(latestAssistant);
                this.shouldStick = false;
            } else {
                if (hasNewAssistant) this.lastAssistant = latestAssistant;
                if ((target === this.messages || target?.id === 'msg-tail') && this.shouldStick) this.scrollBottom();
            }
            if (target?.id === 'msg-head') {
                if (this.historyAnchor?.isConnected && this.historyAnchorTop != null) {
                    const drift = this.historyAnchor.getBoundingClientRect().top - this.historyAnchorTop;
                    if (Math.abs(drift) > 0.5) this.messages.scrollTop += drift;
                }
                this.historyAnchor = null;
                this.historyAnchorTop = null;
                this.loadingOlder = false;
                if (this.jumpTarget) this.jumpToHash();
            }
        }

        copyClean(event) {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || !event.clipboardData) return;
            const holder = document.createElement('div');
            for (let i = 0; i < selection.rangeCount; i++) holder.append(selection.getRangeAt(i).cloneContents());
            const noise = 'button, [role="button"], .sr-only, i.ph, svg, input, select, textarea, form, [data-no-copy]';
            if (!holder.querySelector(noise)) return; // nothing to strip: let the browser copy as usual
            holder.querySelectorAll(noise).forEach(el => el.remove());
            // innerText needs layout to keep line breaks between blocks.
            holder.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre-wrap';
            document.body.append(holder);
            const text = holder.innerText.replace(/\n{3,}/g, '\n\n').trim();
            const html = holder.innerHTML;
            holder.remove();
            event.preventDefault();
            event.clipboardData.setData('text/plain', text);
            event.clipboardData.setData('text/html', html);
        }

        destroy() {
            this.mentionBox?.remove();
            this.abort.abort();
        }
    }

    function mount() {
        const panel = document.getElementById('chat-panel');
        if (!panel) return;
        if (current?.panel === panel) return;
        current?.destroy();
        const next = new ChatController(panel);
        current = next;
        if (!next.mount()) { next.destroy(); current = null; }
    }

    document.addEventListener('htmx:before:cleanup', event => {
        const target = event.target;
        if (current && (target === current.panel || target?.contains?.(current.panel))) {
            current.destroy();
            current = null;
        }
    });
    document.addEventListener('htmx:before:swap', event => current?.beforeSwap(event));
    document.addEventListener('htmx:after:swap', event => {
        current?.afterSwap(event);
        mount();
    });
    mount();

})();
