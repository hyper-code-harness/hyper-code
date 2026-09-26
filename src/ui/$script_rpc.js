// Compact popup RPC:
//   <button hx-popup="agent.toolDetails" hx-popup-params='{"agentId":"ef","idx":7}'>
//   <form hx-popup="secureInput.submit">…named controls…</form>
// htmx owns POST and swap; this script only supplies the RPC envelope. It is a
// plain listener, not an htmx extension: it hooks no htmx internals.
(() => {
    const install = () => {
        if (!window.htmx || window.__hyperRpcInstalled) return false;
        window.__hyperRpcInstalled = true;
        document.addEventListener('click', event => {
            const elt = event.target.closest?.('[hx-popup]');
            if (!elt) return;
            // A submit button is inside the form carrying hx-popup.
            // Browser submit dispatch proved unreliable after HTMX swaps,
            // so handle the click here — but SEND BEFORE showing loading,
            // otherwise replacing #app-popup-body detaches the form and
            // FormData becomes empty.
            if (elt.tagName === 'FORM') {
                // A <button> inside a form defaults to submit even when
                // type is omitted. Honour HTML semantics; restricting
                // this to explicit [type=submit] made secondary OAuth
                // forms stick on loading after their callback URL.
                const button = event.target.closest('button,input[type="submit"]');
                if (!button || button.getAttribute('type') === 'button') return;
                event.preventDefault();
                send(elt);
                return;
            }
            event.preventDefault();
            send(elt);
        });
        document.addEventListener('submit', event => {
            const form = event.target.closest?.('form[hx-popup]');
            if (!form) return;
            event.preventDefault();
            send(form);
        });
        // HTMX does not swap 4xx/5xx responses. Popup RPC used to stay
        // on "loading…" even though the server had already returned a
        // useful error. Render only the error string via textContent —
        // never raw provider/user HTML.
        document.addEventListener('htmx:response:error', event => {
            const ctx = event.detail?.ctx;
            const target = ctx?.target;
            if (target?.id !== 'app-popup-body') return;
            let message = `Request failed (${ctx?.response?.status || 'unknown'})`;
            try { message = JSON.parse(ctx.text)?.error || message; } catch {}
            const box = document.createElement('div');
            box.className = 'rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error';
            box.textContent = message;
            target.replaceChildren(box);
            document.getElementById('app-popup-title').textContent = 'Could not complete';
        });
        document.body.addEventListener('secure-input-refresh', () => {
            const host = document.getElementById('secure-input-host');
            if (host) send(host);
        });
        const host = document.getElementById('secure-input-host');
        // A pending secure prompt survives a full page reload; check
        // once on boot, but do not open an empty loading dialog.
        if (host && host.dataset.pending === '1') send(host);
        function send(elt) {
            let params = {};
            try { params = JSON.parse(elt.getAttribute('hx-popup-params') || '{}'); } catch { return; }
            if (elt.tagName === 'FORM') for (const [key, value] of new FormData(elt)) {
                if (params[key] === undefined) params[key] = value;
                else if (Array.isArray(params[key])) params[key].push(value);
                else params[key] = [params[key], value];
            }
            const method = elt.getAttribute('hx-popup');
            const title = elt.getAttribute('title') || elt.getAttribute('aria-label') || method;
            const secureSubmit = method === 'secureInput.submit';
            // Snapshot everything htmx needs BEFORE loading() removes the source
            // form from the DOM. htmx source may be the detached element, but
            // values are already complete and target is explicit.
            const values = { method, params: JSON.stringify(params) };
            if (!secureSubmit) window.hyperPopup?.loading(title, 'rpc');
            htmx.ajax('POST', '/rpc', { target: '#app-popup-body', swap: 'innerHTML', values });
        }
    };
    if (!install()) document.addEventListener('DOMContentLoaded', install, { once: true });
})();
