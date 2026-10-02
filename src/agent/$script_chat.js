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
            // The live chip is excluded: it is already a row member by way of
            // its region, and wrapping it would build a second row inside that
            // region instead of joining the one on screen.
            root?.querySelectorAll('.tool[data-tool]:not(#active-tool-call .tool)').forEach(card => this.moveToTray(card));
            // Placed before the rows are summarized: folding reads the row's
            // membership, so the region has to be in its final position first.
            this.placeActiveTool(root);
            root?.querySelectorAll('.tool-tray').forEach(tray => this.summarizeTray(tray));
        }

        // The running call belongs in the row its finished siblings are in: it
        // is the next chip in that row, and a line of its own would say it is a
        // different kind of thing. It also stops the transcript from twitching
        // — a dedicated line appears and disappears with every tool call.
        //
        // The live region is moved, never the chip inside it: htmx owns that
        // element by id, and lifting the chip out would leave the polling shell
        // behind, freezing the indicator at its first render.
        //
        // It is moved into the row unconditionally, empty or not. Parking an
        // empty region next to the row instead put a non-tray element between
        // two tool cards, and moveToTray starts a NEW row whenever the element
        // before a card is not a row — so the next chip opened a second line.
        // An empty region is already invisible (empty:hidden) and a flex item
        // of zero size changes no layout, so there is nothing to gain by
        // treating the two cases differently, and a race to lose.
        placeActiveTool(root) {
            const region = root?.querySelector('#active-tool-call');
            if (!region) return;
            const trays = [...root.querySelectorAll('.tool-tray')].filter(t => !region.contains(t));
            const tray = trays[trays.length - 1];
            // Before the first tool call of a session there is no row yet, so
            // the region stays where the server put it.
            if (!tray) return;
            if (region !== tray.lastElementChild) tray.appendChild(region);
        }

        // A long run of tool calls is one line — "12 tool calls ▸" — that opens
        // in place. Failed and running calls stay visible while folded, so the
        // row still says what went wrong or what is happening now.
        summarizeTray(tray) {
            const tools = [...tray.querySelectorAll(':scope > .tool[data-tool]')];
            // Which call is the latest is a fact about this list, not about DOM
            // order — the live region shares the row and would win :last-child.
            tools.forEach((t, i) => t.classList.toggle('tool-latest', i === tools.length - 1));
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
            // Walk back past the live region: it is a row member, not a wall
            // between two rows. Reading it as "not a row" is what used to start
            // a second line mid-sequence.
            let prev = card.previousElementSibling;
            if (prev?.id === 'active-tool-call') prev = prev.previousElementSibling;
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
