// The agent inspector panel, client side.
//
// 1) Plan editor rows: adding and saving are ordinary HTMX + form operations;
//    only removing and reordering unsaved rows needs JavaScript.
//
// 2) Section redraws: the server pushes ui.metaSection (events.refreshAgentMeta)
//    over the shared event stream, and the section re-fetches itself through
//    the RPC endpoint (ui.agentMetaSectionHtml). The <details> shell comes back
//    with the fragment, so "open" is restored around the swap — a redraw must
//    never fold a section the user has open. Redraws are debounced per slot:
//    an active plan ticks many times a second and must cost one request.
(() => {
    if (window.__hyperMetaInstalled) return;
    window.__hyperMetaInstalled = true;


    const applyPanelState = panel => {
        const collapsed = panel.classList.contains('agent-meta-collapsed');
        const button = panel.querySelector('[data-agent-meta-toggle]');
        button?.setAttribute('aria-expanded', String(!collapsed));
        if (button) {
            button.title = collapsed ? 'Expand agent inspector' : 'Collapse agent inspector';
            button.setAttribute('aria-label', button.title);
        }
    };
    const applyAllPanelStates = root => {
        if (root?.matches?.('[data-agent-meta-panel]')) applyPanelState(root);
        root?.querySelectorAll?.('[data-agent-meta-panel]').forEach(applyPanelState);
    };
    applyAllPanelStates(document);
    document.addEventListener('htmx:after:process', event => applyAllPanelStates(event.target));

    document.addEventListener('click', event => {
        const button = event.target.closest?.('[data-plan-remove], [data-plan-move]');


        const toggle = event.target.closest?.('[data-agent-meta-toggle]');
        if (toggle) {
            const panel = toggle.closest('[data-agent-meta-panel]');
            if (!panel) return;
            event.preventDefault();
            const collapsed = !panel.classList.contains('agent-meta-collapsed');
            panel.classList.toggle('agent-meta-collapsed', collapsed);
            applyPanelState(panel);
            fetch('/ui/right-panel', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ collapsed }),
            }).catch(() => {});
            return;
        }

        if (!button) return;
        const form = button.closest('[data-plan-editor]');
        const tasks = form?.querySelector('[data-plan-tasks]');
        const row = button.closest('[data-plan-task]');
        if (!tasks || !row || row.dataset.taskStatus !== 'pending') return;
        event.preventDefault();
        if (button.matches('[data-plan-remove]')) return row.remove();
        const rows = [...tasks.querySelectorAll('[data-plan-task][data-task-status="pending"]')];
        const index = rows.indexOf(row);
        if (button.matches('[data-plan-move="up"]') && index > 0) tasks.insertBefore(row, rows[index - 1]);
        if (button.matches('[data-plan-move="down"]') && index >= 0 && index < rows.length - 1) tasks.insertBefore(rows[index + 1], row);
    });

    const SECTIONS = ['goal', 'knowledge', 'automation', 'settings', 'team', 'plan'];
    const pending = new Map(); // element -> timer

    function redraw(slot) {
        const details = slot.querySelector(':scope > details');
        const wasOpen = details ? details.open : null;
        const agentId = slot.id.slice(slot.id.lastIndexOf('-') + 1);
        htmx.ajax('POST', '/rpc', {
            target: slot,
            swap: 'innerHTML',
            values: { method: 'ui.agentMetaSectionHtml', params: JSON.stringify({ agentId, section: slot.dataset.metaSection }) },
        }).then(() => restore(slot, wasOpen), () => {});   // htmx 4 resolves after the swap
    }

    function restore(slot, wasOpen) {
        if (wasOpen === null) return;
        const details = slot.querySelector(':scope > details');
        if (details && details.open !== wasOpen) details.open = wasOpen;
    }

    document.addEventListener('hyper-events', event => {
        const data = event.detail;
        if (data?.type !== 'ui.metaSection' || !data.agentId) return;
        const sections = data.section && data.section !== 'all' ? [data.section] : SECTIONS;
        for (const section of sections) {
            const slot = document.getElementById(`agent-meta-${section}-${data.agentId}`);
            if (!slot) continue; // this agent's panel is not on the page
            clearTimeout(pending.get(slot));
            pending.set(slot, setTimeout(() => { pending.delete(slot); redraw(slot); }, 150));
        }
    });
})();
