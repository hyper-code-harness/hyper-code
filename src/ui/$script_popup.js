// One permanent popup host for the whole application. Page/agent HTMX swaps
// replace content, never the host, so tools, create-agent and secure prompts do
// not lose their target while navigating.
(() => {
    if (window.__hyperPopupInstalled) return;
    window.__hyperPopupInstalled = true;

    let returnFocus = null;

    const present = (dialog, kind = '') => {
        const shell = dialog?.firstElementChild;
        const body = document.getElementById('app-popup-body');
        const file = kind === 'file-preview';
        if (dialog) {
            dialog.style.width = file ? 'min(90rem, calc(100vw - 2rem))' : '';
            dialog.style.height = file ? '97vh' : '';
            dialog.style.maxHeight = file ? '97vh' : '';
        }
        if (shell) {
            shell.style.height = file ? '100%' : '';
            shell.style.maxHeight = file ? '100%' : '';
        }
        if (body) body.className = file
            ? 'app-popup-body min-h-0 flex-1 overflow-hidden bg-base-200 p-0'
            : 'app-popup-body min-h-0 flex-1 overflow-auto bg-base-200/60 p-5 text-xs text-muted';
    };

    window.hyperPopup = {
        open(title = '', kind = '') {
            const dialog = document.getElementById('app-popup');
            const heading = document.getElementById('app-popup-title');
            const active = document.activeElement;
            if (!dialog?.contains(active) && active && active !== document.body) returnFocus = active;
            if (heading) heading.textContent = title;
            if (dialog && kind) dialog.dataset.popupKind = kind;
            if (dialog && !dialog.open) dialog.showModal();
            present(dialog, kind);
        },
        close() {
            const dialog = document.getElementById('app-popup');
            if (dialog?.open) dialog.close();
            if (dialog) delete dialog.dataset.popupKind;
            const focusTarget = returnFocus?.isConnected ? returnFocus : document.getElementById('input');
            present(dialog, '');
            returnFocus = null;
            focusTarget?.focus();
        },
        content(html, title = '', kind = '') {
            const body = document.getElementById('app-popup-body');
            if (body) body.innerHTML = html;
            this.open(title, kind);
        },

        loading(title = '', kind = '') {
            this.open(title, kind);
            const body = document.getElementById('app-popup-body');
            if (body) body.innerHTML = '<div class="text-sm text-faint">loading…</div>';
        },
    };

    // Server fragments can ask to open the permanent host without shipping
    // scripts or creating/removing overlays.
    document.addEventListener('htmx:after:swap', event => {
        const body = event.detail?.ctx?.target;
        if (body?.id !== 'app-popup-body') return;
        const content = body.querySelector('[data-popup-content], [data-secure-input]');
        if (content) {
            window.hyperPopup.open(content.dataset.popupTitle || 'Details', content.dataset.popupKind || '');
            content.querySelector('[autofocus], input, textarea, select')?.focus();
            return;
        }
        const dialog = document.getElementById('app-popup');
        if (!body.innerHTML.trim() && dialog?.dataset.popupKind) window.hyperPopup.close();
    });


    // Secure-input events belong to the popup subsystem. control.js only owns
    // generic runtime UI actions and must not duplicate this lifecycle.
    const applySecureInputEvent = event => {
        const detail = event.detail;
        if (detail?.type !== 'secure-input.prompt' && detail?.type !== 'secure-input.prompt.closed') return;
        document.body.dispatchEvent(new Event('secure-input-refresh'));
    };
    document.addEventListener('hyper-events', applySecureInputEvent);
    document.addEventListener('hyper-ui-event', applySecureInputEvent);

    // Escape is cancellation for a secure prompt, not merely visual closure.
    document.getElementById('app-popup')?.addEventListener('cancel', event => {
        const dialog = event.currentTarget;
        if (dialog?.dataset.popupKind !== 'secure-input') return;
        event.preventDefault();
        document.querySelector('#app-popup-body [data-secure-cancel]')?.click();
    });


    document.getElementById('app-popup-close')?.addEventListener('click', () => {
        const dialog = document.getElementById('app-popup');
        if (dialog?.dataset.popupKind === 'secure-input') {
            document.querySelector('#app-popup-body [data-secure-cancel]')?.click();
            return;
        }
        window.hyperPopup.close();
    });

})();
