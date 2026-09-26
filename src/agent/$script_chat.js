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
            this.lastAssistant = this.latestAssistant();
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
            this.input.addEventListener('keydown', (event) => {
                if (event.isComposing || event.key === 'Process') return;
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!this.input.value.trim() && !this.fileInput?.files?.length) return;
                    this.form.requestSubmit();
                }
            }, { signal });
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
            this.form.addEventListener('dragover', event => { event.preventDefault(); this.form.classList.add('ring-2', 'ring-primary/40'); }, { signal });
            this.form.addEventListener('dragleave', event => { if (!this.form.contains(event.relatedTarget)) this.form.classList.remove('ring-2', 'ring-primary/40'); }, { signal });
            this.form.addEventListener('drop', event => { event.preventDefault(); this.form.classList.remove('ring-2', 'ring-primary/40'); this.addFiles([...(event.dataTransfer?.files || [])]); }, { signal });
            this.form.addEventListener('submit', event => {
                if (!this.input.value.trim() && !this.fileInput?.files?.length) return event.preventDefault();
                this.shouldStick = true;
            }, { signal });
            this.form.addEventListener('htmx:after:request', event => {
                const ctx = event.detail?.ctx;
                if (ctx?.sourceElement !== this.form || !(ctx?.response?.status < 400)) return;
                this.shouldStick = true;
                this.scrollBottom();
                this.renderAttachments();
                requestAnimationFrame(() => { if (this.alive() && this.shouldStick) this.scrollBottom(); });
            }, { signal });
            this.arrangeTools(this.messages);
            this.addInheritedNote();
            document.body.dataset.agentId = this.agentId;
            requestAnimationFrame(() => {
                if (!this.alive()) return;
                this.scrollBottom();
                this.shouldStick = this.isNearBottom();
                this.input.focus();
            });
            return true;
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
            this.attachmentTray.classList.toggle('hidden', files.length === 0);
            this.attachmentTray.classList.toggle('flex', files.length > 0);
            files.forEach((file, index) => {
                const chip = document.createElement('div');
                chip.className = 'flex max-w-56 items-center gap-2 rounded-lg border border-ui-border bg-base-100 px-2 py-1.5 text-xs';
                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img'); img.className = 'size-9 rounded object-cover'; img.src = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(img.src); chip.append(img);
                } else { const icon = document.createElement('i'); icon.className = 'ph ph-file text-faint'; chip.append(icon); }
                const name = document.createElement('span'); name.className = 'min-w-0 flex-1 truncate'; name.textContent = file.name; chip.append(name);
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-faint hover:text-error'; remove.innerHTML = '<i class="ph ph-x"></i>'; remove.addEventListener('click', () => this.removeFile(index), { signal: this.abort.signal }); chip.append(remove);
                this.attachmentTray.append(chip);
            });
        }
        alive() { return current === this && this.panel.isConnected && !this.abort.signal.aborted; }
        isNearBottom() { return this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight <= STICKY_BOTTOM_PX; }
        scrollBottom() { this.messages.scrollTop = this.messages.scrollHeight; }

        latestAssistant() {
            const items = this.messages.querySelectorAll('.assistant');
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
            }
            if (target === this.messages || this.messages.contains(target) || target?.id === 'msg-tail' || target?.id === 'msg-head') {
                this.arrangeTools(this.messages);
            }
        }

        arrangeTools(root) {
            root?.querySelectorAll('.tool[data-tool]').forEach(card => this.moveToTray(card));
            root?.querySelectorAll('.tool-tray').forEach(tray => this.summarizeTray(tray));
        }

        // A long run of tool calls is one line — "12 tool calls ▸" — that opens
        // in place. Failed and running calls stay visible while folded, so the
        // row still says what went wrong or what is happening now.
        summarizeTray(tray) {
            const tools = [...tray.querySelectorAll(':scope > .tool[data-tool]')];
            let toggle = tray.querySelector(':scope > .tool-tray-toggle');
            if (tools.length <= 4) { toggle?.remove(); tray.classList.remove('tool-tray--folded'); return; }
            if (!toggle) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'tool-tray-toggle';
                toggle.dataset.action = 'toggle-tools';
                toggle.addEventListener('click', () => {
                    tray.dataset.open = tray.dataset.open === '1' ? '0' : '1';
                    this.summarizeTray(tray);
                }, { signal: this.abort.signal });
                tray.prepend(toggle);
            } else if (toggle !== tray.firstElementChild) tray.prepend(toggle);
            const open = tray.dataset.open === '1';
            const failed = tools.filter(t => /\btext-error\b/.test(t.className)).length;
            tray.classList.toggle('tool-tray--folded', !open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.innerHTML = `<i class="ph ph-caret-${open ? 'down' : 'right'}" aria-hidden="true"></i><span>${tools.length} tool calls</span>${failed ? `<span class="text-error">· ${failed} failed</span>` : ''}`;
        }

        moveToTray(card) {
            if (card.parentElement?.classList.contains('tool-tray')) return;
            const prev = card.previousElementSibling;
            const tray = prev?.classList.contains('tool-tray') ? prev : document.createElement('div');
            if (!tray.isConnected) {
                tray.className = 'tool-tray';
                card.parentNode.insertBefore(tray, card);
            }
            tray.appendChild(card);
            const next = tray.nextElementSibling;
            if (next?.classList.contains('tool-tray')) {
                while (next.firstChild) tray.appendChild(next.firstChild);
                next.remove();
            }
        }


        destroy() {
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

    document.body.addEventListener('htmx:before:cleanup', event => {
        const target = event.target;
        if (current && (target === current.panel || target?.contains?.(current.panel))) {
            current.destroy();
            current = null;
        }
    });
    document.body.addEventListener('htmx:before:swap', event => current?.beforeSwap(event));
    document.body.addEventListener('htmx:after:swap', event => {
        current?.afterSwap(event);
        mount();
    });
    mount();

})();
