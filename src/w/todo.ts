/**
 * Draws an editable to-do list: the current item, a queue the person reorders by dragging a row (the current item too while the list waits), an "add" field, the finished items folded under a "Done · N" line at the bottom, and a footer with the count and the actions.
 *
 * Use for a short ordered list a person works through and edits in place (a chat's plan in agent.planPopup). The
 * widget only draws: every change — add, done, reopen, remove, rename, move, detach, start, edit — is sent by the page
 * script (/ui/todo.js) to the `rpc` function as `{ ...params, action, id?, title?, order? }`, and the list in its
 * answer replaces this one; an empty answer closes the popup the list is in. With `topic` the list re-reads itself
 * when the server refreshes that live topic. With `attach` items take images and files: pasted or dropped into the
 * add field (a new item with them), dropped on an open item or picked with its paperclip; the picked files are the
 * chat composer's chips (/w/files.js) and are uploaded to that URL.
 * @param opts.items Items in order; done ones are drawn under the others, folded, whatever their place.
 * @param opts.rpc Runtime function that applies a change and answers with the new list.
 * @param opts.state What the list is doing: working (the current item spins), waiting, or done. @default "waiting"
 * @param opts.summary One quiet line in the footer ("2 of 5 done · 1h 12m").
 * @param opts.topic Live topic that makes the list re-read itself (procs.events.refresh).
 * @param opts.start Label of the primary button in the footer (action "start"); omit for no button.
 * @param opts.edit Label of the quiet button in the footer (action "edit"); omit for no button.
 * @param opts.placeholder Hint in the add field. @default "Add a task…"
 * @param opts.error Message of a change that failed, shown above the list.
 * @param opts.empty Words shown while there are no items (what the list is for and how to begin).
 * @param opts.attach URL that takes uploaded files (multipart `files`, with `id` of an item or `title` of a new one) and answers with the new list; omit for a list without attachments.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Items in order; done ones are drawn under the others, folded, whatever their place. */
    items: Array<{
        /** Stable id sent back with a change. */
        id: string;
        /** Item text. */
        title: string;
        /** done is finished, active is the one in work, pending waits in the queue. */
        status: "done" | "active" | "pending";
        /** Quiet text under the title (the current item's instructions). */
        note?: string;
        /** Time it took, as text ("31m 46s"). */
        time?: string;
        /** Start of a running clock (ms epoch) drawn instead of time. */
        since?: number;
        /** Images and files attached to the item, drawn under its title; an open item's can be taken off (action "detach" with `file`). */
        files?: Array<{ id: string; name: string; url: string; image?: boolean }>;
    }>;
    /** Runtime function that applies a change and answers with the new list. */
    rpc: { method: string; params?: Record<string, unknown> };
    /** What the list is doing: working (the current item spins), waiting, or done. @default "waiting" */
    state?: "working" | "waiting" | "done";
    /** One quiet line in the footer ("2 of 5 done · 1h 12m"). */
    summary?: string;
    /** Live topic that makes the list re-read itself (procs.events.refresh). */
    topic?: string;
    /** Label of the primary button in the footer (action "start"); omit for no button. */
    start?: string;
    /** Label of the quiet button in the footer (action "edit"); omit for no button. */
    edit?: string;
    /** Hint in the add field. @default "Add a task…" */
    placeholder?: string;
    /** Message of a change that failed, shown above the list. */
    error?: string;
    /** Words shown while there are no items (what the list is for and how to begin). */
    empty?: string;
    /** URL that takes uploaded files (multipart `files`, with `id` of an item or `title` of a new one) and answers with the new list; omit for a list without attachments. */
    attach?: string;
}): string {
    const w = ctx.fns.w;
    const esc = (v: unknown) => w.escape({ text: String(v ?? "") });
    const state = opts.state ?? "waiting";
    const open = opts.items.filter(item => item.status !== "done");
    const done = opts.items.filter(item => item.status === "done");
    // The round mark of an item is its button: a click finishes an open item and reopens a finished one. It shows
    // the state at rest and what the click does on hover.
    const mark = (item: (typeof opts.items)[number]) => {
        const finished = item.status === "done";
        const rest = finished ? w.icon({ name: "check-circle", size: 16 })
            : item.status === "active" ? (state === "working" ? w.spinner({ kind: "arc", size: 16 }) : w.icon({ name: "circle", size: 16 }))
            : w.icon({ name: "circle", size: 16 });
        const over = w.icon({ name: finished ? "arrow-counter-clockwise" : "check-circle", size: 16 });
        return w.pressable({
            html: `<span class="w-todo-rest">${rest}</span><span class="w-todo-over">${over}</span>`,
            label: finished ? `Reopen: ${item.title}` : `Mark done: ${item.title}`,
            title: finished ? "Reopen" : "Mark done",
            class: "w-todo-mark",
            attrs: { "data-todo-act": finished ? "reopen" : "done" },
        });
    };
    // What can change places: the queue, and the current item too while nobody works on it. One such row alone has
    // nowhere to go, so it gets no grip.
    const canMove = open.filter(item => item.status === "pending" || (item.status === "active" && state !== "working"));
    const movableIds = new Set(canMove.length > 1 ? canMove.map(item => item.id) : []);
    const row = (item: (typeof opts.items)[number]) => {
        const queued = item.status === "pending";
        // The grip and the cross sit at the end of the row and show on hover, so the text starts right after the mark.
        const movable = movableIds.has(item.id);
        const grip = movable
            ? w.pressable({ html: w.icon({ name: "dots-six-vertical", size: 16 }), label: `Reorder: ${item.title}`, title: "Drag to reorder (or ↑ ↓)", class: "w-todo-grip", attrs: { "data-todo-grip": true } })
            : "";
        // The running clock starts with the server's reading, so a list swapped in mid-second does not blink "…"
        // until the page script (/ui/tool-timer.js) ticks; the script then keeps it going.
        const secs = Math.max(0, Math.round((Date.now() - Number(item.since ?? 0)) / 1000));
        const reading = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
        const clock = item.since ? w.timer({ since: item.since }).replace(">…<", `>${reading}<`) : item.time ? `<span class="w-todo-time">${esc(item.time)}</span>` : "";
        // An open item is renamed in place: a click (or Enter) on its text turns it into a field.
        const text = item.status === "done"
            ? `<span class="w-todo-text">${esc(item.title)}</span>`
            : `<span class="w-todo-text" data-todo-title tabindex="0" role="button" title="Click to rename">${esc(item.title)}</span>`;
        const note = item.note ? `<p class="w-todo-note">${esc(item.note)}</p>` : "";
        // Attachments look as they do under a chat message (w-attach-img / w-attach-file); an open item's get a cross.
        const files = (item.files ?? []).map(file => ({ ...file, url: w.safeUrl({ url: file.url, image: !!file.image }) })).filter(file => file.url).map(file => {
            const link = file.image
                ? `<a class="w-attach-img" href="${esc(file.url)}" target="_blank" rel="noopener" draggable="false" title="${esc(file.name)}"><img src="${esc(file.url)}" alt="${esc(file.name)}" loading="lazy" draggable="false"></a>`
                : `<a class="w-attach-file" href="${esc(file.url)}" target="_blank" rel="noopener" draggable="false">${w.icon({ name: "file", size: 14 })}<span>${esc(file.name)}</span></a>`;
            const off = item.status === "done" ? "" : w.pressable({ html: w.icon({ name: "x", size: 12 }), label: `Remove ${file.name}`, title: "Remove the file", class: "w-todo-detach", attrs: { "data-todo-act": "detach", "data-todo-file": file.id } });
            return `<span class="w-todo-file" data-todo-file-id="${esc(file.id)}">${link}${off}</span>`;
        }).join("");
        const pick = opts.attach && item.status !== "done" ? w.pressable({ html: w.icon({ name: "paperclip", size: 14 }), label: `Attach files to: ${item.title}`, title: "Attach images or files", class: "w-todo-clip", attrs: { "data-todo-pick": true } }) : "";
        const remove = queued ? w.pressable({ html: w.icon({ name: "x", size: 14 }), label: `Remove: ${item.title}`, title: "Remove", class: "w-todo-remove", attrs: { "data-todo-act": "remove" } }) : "";
        return `<li class="w-todo-item" data-status="${item.status}" data-todo-id="${esc(item.id)}"${movable ? " data-todo-movable" : ""}>${mark(item)}<div class="w-todo-body">${text}${note}${files ? `<div class="w-todo-files">${files}</div>` : ""}</div>${clock}${pick}${grip}${remove}</li>`;
    };
    const start = opts.start ? w.button({ label: opts.start, icon: "play", tone: "primary", size: "sm", attrs: { "data-todo-act": "start" } }) : "";
    const edit = opts.edit ? w.button({ label: opts.edit, icon: "pencil-simple", tone: "ghost", size: "sm", attrs: { "data-todo-act": "edit" } }) : "";
    const total = opts.items.length;
    const head = !total && opts.empty ? `<p class="w-todo-empty">${esc(opts.empty)}</p>` : "";
    const hint = opts.placeholder ?? "Add a task…";
    // With attachments the field carries a paperclip, a hidden picker and the tray of picked files above it.
    const picker = opts.attach ? `<input type="file" multiple hidden data-todo-picker>` : "";
    const clip = opts.attach ? w.pressable({ html: w.icon({ name: "paperclip", size: 14 }), label: "Attach images or files to the new task", title: "Attach images or files (or paste, or drop them here)", class: "w-todo-clip", attrs: { "data-todo-pick": true } }) : "";
    const add = `<form class="w-todo-add" data-todo-add>${opts.attach ? `<div class="w-composer-files" data-todo-tray></div>` : ""}<div class="w-todo-add-row"><span class="w-todo-mark" aria-hidden="true">${w.icon({ name: "plus", size: 16 })}</span><input name="title" maxlength="300" autocomplete="off" enterkeyhint="done" placeholder="${esc(hint)}" aria-label="${esc(hint)}">${picker}${clip}${w.kbd({ keys: "↵" })}</div></form>`;
    const hooks = w.hooks({ attrs: { "data-todo": true, "data-todo-rpc": opts.rpc.method, "data-todo-params": JSON.stringify(opts.rpc.params ?? {}), "data-todo-attach": opts.attach, "data-live-topic": opts.topic, "data-state": state } });
    return `<div class="w-todo"${hooks}>${head}`
        + `<p class="w-todo-error" data-todo-error role="alert"${opts.error ? "" : " hidden"}>${esc(opts.error ?? "")}</p>`
        + `<ol class="w-todo-list" data-todo-open>${open.map(row).join("")}</ol>${add}`
        // Finished items are folded away: one "Done · N" line that opens them (the page script keeps it open across a change).
        + (done.length ? `<details class="w-todo-done" data-todo-done-box><summary><span class="w-todo-mark" aria-hidden="true">${w.icon({ name: "caret-right", size: 12 })}</span><span class="${w.mix({ mixes: [{ caption: true }] })}">Done · ${done.length}</span></summary><ol class="w-todo-list" data-todo-done>${done.map(row).join("")}</ol></details>` : "")
        + (total ? `<div class="w-todo-foot"><span class="w-todo-summary" data-todo-summary>${esc(opts.summary ?? "")}</span><span class="w-todo-actions">${edit}${start}</span></div>` : "")
        + `</div>`;
}
