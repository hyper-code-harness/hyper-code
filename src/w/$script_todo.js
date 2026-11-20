// The behaviour of w.todo — an editable list drawn by the server.
//
// Every change is one call of the list's runtime function through POST /rpc: { ...params, action, id?, title?,
// order?, file? } — or, with files, one upload to the list's attach address. The answer is the new list and replaces the old one; an empty answer closes the popup the list is in.
// Nothing is kept here: the list on screen is what the server last said. The script only adds what HTML cannot —
// dragging rows into order, renaming in place, picking and dropping files, keeping the field and the focus
// across a replace.
(() => {
    if (window.__hyperTodoInstalled) return;
    window.__hyperTodoInstalled = true;

    const rootOf = el => el?.closest?.('[data-todo]');
    const same = (a, b) => a.dataset.todoRpc === b.dataset.todoRpc && a.dataset.todoParams === b.dataset.todoParams;
    const current = todo => todo.isConnected ? todo : [...document.querySelectorAll('[data-todo]')].find(el => same(el, todo));
    let chain = Promise.resolve();
    let drag = null;

    // What has the focus, by meaning, so it can be given back after the list is replaced.
    function focusOf(todo) {
        const el = document.activeElement;
        if (!el || !todo.contains(el)) return null;
        if (el.closest('[data-todo-add]')) return { add: true, start: el.selectionStart, end: el.selectionEnd };
        if (el.matches('[data-todo-done-box] > summary')) return { summary: true };
        const id = el.closest('[data-todo-id]')?.dataset.todoId;
        const part = el.matches('[data-todo-grip]') ? '[data-todo-grip]' : el.matches('[data-todo-title]') ? '[data-todo-title]' : el.matches('.w-todo-mark') ? '.w-todo-mark' : '';
        return { id, part };
    }
    function refocus(todo, was) {
        if (!was) return;
        const add = todo.querySelector('[data-todo-add] input');
        if (was.summary) { (todo.querySelector('[data-todo-done-box] > summary') || add)?.focus(); return; }
        if (was.add) { add?.focus(); try { add?.setSelectionRange(was.start, was.end); } catch {} return; }
        const item = was.id ? [...todo.querySelectorAll('[data-todo-id]')].find(li => li.dataset.todoId === was.id) : null;
        const target = item && was.part ? item.querySelector(was.part) : null;
        // The mark of a ticked item moved to the other list with a new meaning: do not land on "Reopen" by accident.
        if (target && was.part !== '.w-todo-mark') target.focus(); else add?.focus();
    }

    // The list without what changes by itself (the running clock's reading, marks of this script).
    const shape = todo => todo.outerHTML.replace(/(<span class="w-timer"[^>]*>)[^<]*/g, '$1').replace(/ data-(busy|stale)=""/g, '');
    // After a drag or a rename: catch up with what arrived meanwhile.
    function settle(todo) {
        todo = current(todo);
        if (!todo || !('stale' in todo.dataset)) return;
        delete todo.dataset.stale;
        send(todo, {}, true);
    }

    function fail(todo, message) {
        const box = todo.querySelector('[data-todo-error]');
        if (!box) return;
        box.textContent = message;
        box.hidden = !message;
    }

    // One change at a time, in the order they were made: each is applied to the list the previous one left.
    // Changes that follow fast (↓ ↓, Enter Enter) are drawn at once and saved in turn; only the answer to the
    // last of them is shown — an earlier answer describes a list the screen has already moved on from, and
    // showing it would make a row jump back and forth.
    let waiting = 0;
    function send(todo, change, quiet) {
        if (!quiet) waiting++;
        chain = chain.then(() => apply(todo, change, quiet)).catch(error => console.error('w.todo:', error));
        return chain;
    }
    async function apply(todo, change, quiet) {
        todo = current(todo);
        if (!todo) { if (!quiet) waiting--; return; }
        // A background re-read with changes still on their way: their answer brings the list anyway.
        if (quiet && waiting) return;
        let params = {};
        try { params = JSON.parse(todo.dataset.todoParams || '{}'); } catch {}
        if (!quiet) todo.dataset.busy = '';
        let res, text = '';
        const { files, ...fields } = change;
        try {
            if (files) {
                // Files go the way a chat message's do: multipart to the list's upload address, which answers
                // with the new list like any other change.
                const form = new FormData();
                for (const [name, value] of Object.entries(fields)) form.set(name, value);
                for (const file of files) form.append('files', file);
                res = await fetch(todo.dataset.todoAttach, { method: 'POST', headers: window.hyperRpcCsrfHeaders?.() || {}, body: form });
            } else {
                res = await fetch('/rpc', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...(window.hyperRpcCsrfHeaders?.() || {}) },
                    body: JSON.stringify({ method: todo.dataset.todoRpc, params: { ...params, ...fields } }),
                });
            }
            text = await res.text();
        } catch (error) {
            if (!quiet) waiting--;
            if (!waiting) delete todo.dataset.busy;
            if (!quiet) { fail(todo, 'No connection — the change was not saved.'); giveBack(todo, change); }
            return;
        }
        if (!quiet) waiting--;
        todo = current(todo);
        if (!todo) return;
        if (!waiting) delete todo.dataset.busy;
        if (!res.ok) {
            let message = `Could not save (${res.status})`;
            try { message = JSON.parse(text).error || message; } catch {}
            if (!quiet) { fail(todo, message); giveBack(todo, change); }
            return;
        }
        // An empty answer: the server finished with this list (it opened something else) — close its popup.
        if (!text.trim()) { if (todo.closest('#app-popup')) window.hyperPopup?.close(); return; }
        if (waiting) return;
        // The list must not be pulled from under a hand that is dragging or typing a new name: it is re-read when
        // the hand lets go (settle).
        if (drag || todo.querySelector('.w-todo-edit')) { todo.dataset.stale = ''; return; }
        const page = document.createElement('template');
        page.innerHTML = text;
        const next = page.content.querySelector('[data-todo]');
        if (!next) return;
        // The finished items stay unfolded if the person unfolded them.
        const folded = next.querySelector('[data-todo-done-box]');
        if (folded && todo.querySelector('[data-todo-done-box]')?.open) folded.open = true;
        // The answer usually says what the screen already shows (a move was drawn before it was sent): leave the
        // elements alone then, so a click that is on its way still lands.
        if (shape(next) === shape(todo)) return;
        const was = focusOf(todo);
        const typed = todo.querySelector('[data-todo-add] input')?.value ?? '';
        const input = next.querySelector('[data-todo-add] input');
        if (input && typed) input.value = typed;
        const title = page.content.querySelector('[data-popup-content]')?.dataset.popupTitle;
        const heading = todo.closest('#app-popup') ? document.getElementById('app-popup-title') : null;
        if (heading && title) heading.textContent = title;
        next.todoFiles = todo.todoFiles;
        todo.replaceWith(next);
        tray(next);
        refocus(next, was);
    }

    // ── buttons: the mark (done / reopen), remove, start, edit ───────────────────────────────────────────────
    document.addEventListener('click', event => {
        // The click that ends a row drag lands on that row and is not a click on its text. Only that one: a button
        // pressed right after a drag must still work.
        if (dragged && Date.now() - draggedAt < 300 && dragged.contains(event.target)) { dragged = null; event.preventDefault(); return; }
        dragged = null;
        const pick = event.target.closest?.('[data-todo-pick]');
        if (pick && rootOf(pick)) {
            event.preventDefault();
            // The one picker serves the new task (the field's paperclip) and any open task (its own paperclip).
            // Who it is for is remembered here, not on the element: the list may be replaced while the system's
            // file dialog is open (the agent finished a task), and the files must still land where they were meant.
            const todo = rootOf(pick);
            const picker = todo.querySelector('[data-todo-picker]');
            const id = pick.closest('[data-todo-id]')?.dataset.todoId || '';
            picker.onchange = () => {
                const files = [...picker.files];
                picker.value = '';
                const now = current(todo);
                if (!now || !files.length) return;
                if (id) send(now, { id, files }); else pickUp(now, files);
            };
            picker.click();
            return;
        }
        const button = event.target.closest?.('[data-todo-act]');
        const todo = rootOf(button);
        if (!todo) {
            const title = event.target.closest?.('[data-todo-title]');
            if (title && rootOf(title)) rename(title);
            return;
        }
        event.preventDefault();
        const id = button.closest('[data-todo-id]')?.dataset.todoId;
        send(todo, { action: button.dataset.todoAct, ...(id ? { id } : {}), ...(button.dataset.todoFile ? { file: button.dataset.todoFile } : {}) });
    });

    // ── add: Enter in the field; it stays focused and empty for the next one ─────────────────────────────────
    document.addEventListener('submit', event => {
        const form = event.target.closest?.('[data-todo-add]');
        const todo = rootOf(form);
        if (!todo) return;
        event.preventDefault();
        const input = form.querySelector('input[name="title"]');
        const title = input.value.trim();
        const files = todo.todoFiles || [];
        if (!title && !files.length) return;
        input.value = '';
        todo.todoFiles = [];
        tray(todo);
        // With files the new task is made by the upload: it takes the title and the files in one request.
        if (files.length) send(todo, { title, files });
        else send(todo, { action: 'add', title });
    });

    // ── attachments: images and files for a new task (paste, drop, the paperclip) or for an open one ──────────
    // Picked files of the task being written wait on the list element and are drawn as the chat composer's chips.
    function tray(todo) {
        const box = todo.querySelector('[data-todo-tray]');
        if (!box) return;
        const files = todo.todoFiles || [];
        box.replaceChildren(...files.map((file, index) => window.hyperFiles.chip(file, () => { todo.todoFiles = files.filter((_, i) => i !== index); tray(todo); })));
    }
    function pickUp(todo, files) {
        if (!files.length) return;
        todo.todoFiles = [...(todo.todoFiles || []), ...files].slice(0, 10);
        tray(todo);
        todo.querySelector('[data-todo-add] input[name="title"]')?.focus();
    }
    // A new task whose upload failed: its words and files go back into the field instead of being lost.
    function giveBack(todo, change) {
        if (!change.files || change.id) return;
        const input = todo.querySelector('[data-todo-add] input[name="title"]');
        if (input && !input.value) input.value = change.title || '';
        pickUp(todo, change.files);
    }
    document.addEventListener('paste', event => {
        const input = event.target.closest?.('[data-todo-add] input[name="title"]');
        const todo = rootOf(input);
        if (!todo?.dataset.todoAttach) return;
        const files = window.hyperFiles.fromPaste(event);
        if (!files.length) return;
        // A screenshot is pasted as a file; words that came with it still go into the field.
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') || '';
        if (text) input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
        pickUp(todo, files);
    });
    // A file dragged from outside lands on the open task under it, or — anywhere else on the list — on the new task.
    const dropOn = event => {
        const todo = rootOf(event.target);
        if (!todo?.dataset.todoAttach || !window.hyperFiles.dragged(event)) return null;
        const item = event.target.closest('[data-todo-id]:not([data-status="done"])');
        return { todo, item, mark: item || todo.querySelector('[data-todo-add]') };
    };
    const unmark = () => document.querySelectorAll('[data-todo] [data-drop]').forEach(el => el.removeAttribute('data-drop'));
    document.addEventListener('dragover', event => {
        const over = dropOn(event);
        if (!over) return;
        event.preventDefault();
        if (!over.mark.hasAttribute('data-drop')) { unmark(); over.mark.setAttribute('data-drop', ''); }
    });
    document.addEventListener('dragleave', event => { if (!rootOf(event.relatedTarget)) unmark(); });
    document.addEventListener('drop', event => {
        const over = dropOn(event);
        unmark();
        if (!over) return;
        event.preventDefault();
        const files = [...(event.dataTransfer?.files || [])].slice(0, 10);
        if (!files.length) return;
        if (over.item) send(over.todo, { id: over.item.dataset.todoId, files }); else pickUp(over.todo, files);
    });

    // ── rename in place ─────────────────────────────────────────────────────────────────────────────────────
    function rename(span) {
        if (span.querySelector('input')) return;
        const todo = rootOf(span);
        const id = span.closest('[data-todo-id]').dataset.todoId;
        const before = span.textContent;
        const input = document.createElement('input');
        input.className = 'w-todo-edit';
        input.maxLength = 300;
        input.value = before;
        input.setAttribute('aria-label', 'Task title');
        span.textContent = '';
        span.append(input);
        input.focus();
        input.select();
        let over = false;
        const finish = save => {
            if (over) return;
            over = true;
            const title = input.value.replace(/\s+/g, ' ').trim();
            span.textContent = save && title ? title : before;
            if (save && title && title !== before) send(todo, { action: 'rename', id, title });
            settle(todo);
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); span.focus(); }
            // Escape belongs to the field here, not to the dialog around it.
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); span.focus(); }
        });
        input.addEventListener('blur', () => finish(true));
    }

    // ── reorder: drag a row (by any part of it, or by its grip), or ↑ ↓ on the grip ─────────────────────────────
    // The rows that can change places: the queue, and the current item too while nobody works on it.
    const queue = list => [...list.querySelectorAll(':scope > [data-todo-movable]')];
    const sendOrder = (todo, list) => send(todo, { action: 'move', order: queue(list).map(li => li.dataset.todoId) });
    // A press on a row that has not moved yet: it becomes a drag after a few pixels, and stays a click otherwise.
    let press = null;
    let draggedAt = 0;
    let dragged = null;

    function begin() {
        const { todo, item, grip, y, pointerId } = press;
        const list = item.parentElement;
        const items = queue(list);
        const boxes = items.map(li => li.getBoundingClientRect());
        const from = items.indexOf(item);
        const holder = grip || item;
        try { holder.setPointerCapture(pointerId); } catch {}
        window.getSelection?.()?.removeAllRanges();
        drag = { todo, list, item, items, boxes, from, to: from, startY: y, pointerId, holder, byRow: !grip };
        item.dataset.dragging = '';
        list.dataset.sorting = '';
    }

    document.addEventListener('pointerdown', event => {
        const item = event.target.closest?.('[data-todo-movable]');
        const todo = rootOf(item);
        if (!todo || event.button > 0 || drag) return;
        const grip = event.target.closest('[data-todo-grip]');
        // A finger on a row scrolls the list, so it drags by the grip only; a mouse drags by either.
        if (!grip && (event.pointerType === 'touch' || event.target.closest('button, input, a'))) return;
        if (queue(item.parentElement).length < 2) return;
        press = { todo, item, grip, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        if (!grip) return;
        // The grip drags at once. Focus without a ring: the hand is on the mouse; ↑ ↓ still work from here.
        event.preventDefault();
        grip.focus({ focusVisible: false });
        begin();
    });
    document.addEventListener('pointermove', event => {
        if (press && !drag && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 4) begin();
        if (!drag || event.pointerId !== drag.pointerId) return;
        const { items, boxes, from, item } = drag;
        const first = boxes[0], last = boxes[boxes.length - 1], own = boxes[from];
        // The row stays inside its queue; where it lands follows the hand, so pulling past an end means that end.
        const moved = event.clientY - drag.startY;
        const dy = Math.max(first.top - own.top, Math.min(last.bottom - own.bottom, moved));
        item.style.transform = `translateY(${dy}px)`;
        const middle = own.top + own.height / 2 + moved;
        let to = from;
        boxes.forEach((box, index) => {
            const half = box.top + box.height / 2;
            if (index < from && middle < half) to = Math.min(to, index);
            if (index > from && middle > half) to = Math.max(to, index);
        });
        drag.to = to;
        // The others step aside by the height of the dragged one.
        items.forEach((li, index) => {
            if (li === item) return;
            const shift = index > from && index <= to ? -own.height : index < from && index >= to ? own.height : 0;
            li.style.transform = shift ? `translateY(${shift}px)` : '';
        });
    });
    function drop(commit) {
        const pressed = press?.todo;
        press = null;
        // A press that never became a drag: catch up with what arrived while the row was held.
        if (!drag) { if (pressed) settle(pressed); return; }
        const { todo, list, item, items, from, to, holder, pointerId, byRow } = drag;
        drag = null;
        // The release of a row drag is not a click on its text.
        if (byRow) { draggedAt = Date.now(); dragged = item; }
        try { holder.releasePointerCapture(pointerId); } catch {}
        delete list.dataset.sorting;
        for (const li of items) li.style.transform = '';
        delete item.dataset.dragging;
        if (!commit || to === from) { settle(todo); return; }
        const others = items.filter(li => li !== item);
        list.insertBefore(item, others[to] ?? others[others.length - 1].nextSibling);
        sendOrder(todo, list);
        settle(todo);
    }
    document.addEventListener('pointerup', event => { if (!press || event.pointerId === press.pointerId) drop(true); });
    document.addEventListener('pointercancel', event => { if (!press || event.pointerId === press.pointerId) drop(false); });
    // A press on a row must not start a text selection or the browser's own drag instead of ours.
    document.addEventListener('selectstart', event => { if (press || drag) event.preventDefault(); });
    document.addEventListener('dragstart', event => { if (press || drag) event.preventDefault(); });

    document.addEventListener('keydown', event => {
        if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); drop(false); return; }
        const title = event.target.closest?.('[data-todo-title]');
        if (title && event.target === title && (event.key === 'Enter' || event.key === 'F2') && rootOf(title)) { event.preventDefault(); rename(title); return; }
        const grip = event.target.closest?.('[data-todo-grip]');
        const todo = rootOf(grip);
        if (!todo || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        const item = grip.closest('[data-todo-id]');
        const list = item.parentElement;
        const items = queue(list);
        const at = items.indexOf(item);
        const to = at + (event.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= items.length) return;
        event.preventDefault();
        if (to < at) list.insertBefore(item, items[to]); else list.insertBefore(item, items[to].nextSibling);
        grip.focus();
        sendOrder(todo, list);
    }, true);

    // ── live: the server says the list's topic changed (events/client.js sends hyper-live to the element) ────
    document.addEventListener('hyper-live', event => {
        const todo = event.target?.matches?.('[data-todo]') ? event.target : null;
        if (!todo) return;
        // While a row is held the list is not re-read; it is marked, and catches up when the hand lets go (settle).
        if (drag || press) todo.dataset.stale = '';
        else send(todo, {}, true);
    }, true);
})();
