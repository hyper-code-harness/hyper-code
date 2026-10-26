/**
 * Draws the message input of a chat: an optional line of notes above the text (a prompt inject that differs from
 * the default), the text, and the toolbar under it — attach, tools (model, effort), meters (context ring, quiet
 * settings) and send, or stop with the "working" arc while the agent runs. A full-width footer: a hairline above,
 * the field centred at the reading width, focus is an accent line on top. Compact puts attach, text and send on
 * one line (the folded chat strip — also when an ancestor carries data-chat-collapsed).
 *
 * Attachments: with `files` the form posts multipart, holds a hidden file input and an empty tray
 * ([data-attachments]) a page script fills; the attach button carries [data-attach-button].
 * @param opts.post Where the form posts.
 * @param opts.placeholder Hint in the empty field. @default "Ask the agent…"
 * @param opts.tools Trusted HTML of the tool chips on the left (model, effort).
 * @param opts.meters Trusted HTML on the right before send (context ring, quiet settings).
 * @param opts.above Trusted HTML of notes shown above the text (a non-default prompt inject).
 * @param opts.send Trusted HTML that replaces the send button (a live region holding w.sendButton).
 * @param opts.running The agent is working: stop instead of send.
 * @param opts.stop What stop does.
 * @param opts.compact One line: + text send. @default false
 * @param opts.files Accept attachments: the file types the picker offers (an accept list), or true for any.
 * @param opts.id Id of the form element.
 * @param opts.inputId Id of the text field. @default "input" with id, none without
 * @param opts.hidden Hidden fields sent with every message (name → value).
 * @param opts.hint Tooltip of the text field (its keys).
 * @param opts.attrs Behaviour hooks on the form (w.hooks): data-*, aria-*.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Where the form posts. */
    post: string;
    /** Hint in the empty field. @default "Ask the agent…" */
    placeholder?: string;
    /** Trusted HTML of the tool chips on the left (model, effort). */
    tools?: string;
    /** Trusted HTML on the right before send (context ring, quiet settings). */
    meters?: string;
    /** Trusted HTML of notes shown above the text (a non-default prompt inject). */
    above?: string;
    /** Trusted HTML that replaces the send button (a live region holding w.sendButton). */
    send?: string;
    /** The agent is working: stop instead of send. */
    running?: boolean;
    /** What stop does. */
    stop?: types.w.Action;
    /** One line: + text send. @default false */
    compact?: boolean;
    /** Accept attachments: the file types the picker offers (an accept list), or true for any. */
    files?: string | boolean;
    /** Id of the form element. */
    id?: string;
    /** Id of the text field. */
    inputId?: string;
    /** Hidden fields sent with every message (name → value). */
    hidden?: Record<string, string>;
    /** Tooltip of the text field (its keys). */
    hint?: string;
    /** Behaviour hooks on the form (w.hooks): data-*, aria-*. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const a = (n: string, v: unknown) => v === undefined || v === null || v === "" ? "" : ` ${n}="${esc(v)}"`;
    const files = opts.files !== undefined && opts.files !== false;
    const send = opts.send ?? ctx.fns.w.sendButton({ running: opts.running, stop: opts.stop });
    const attach = ctx.fns.w.iconButton({ icon: "plus", label: "Attach files", action: { action: "attach" }, attrs: files ? { "data-attach-button": true } : undefined });
    const hidden = Object.entries(opts.hidden ?? {}).map(([n, v]) => `<input type="hidden" name="${esc(n)}" value="${esc(v)}">`).join("");
    const picker = files ? `<input type="file" name="files" multiple hidden${a("id", opts.id ? "files" : undefined)}${typeof opts.files === "string" ? a("accept", opts.files) : ""}>` : "";
    return `<form class="w-composer"${opts.compact ? " data-compact" : ""}${a("id", opts.id)}${ctx.fns.w.hooks({ attrs: opts.attrs })} hx-post="${esc(opts.post)}" hx-trigger="submit" hx-swap="none"${files ? ' hx-encoding="multipart/form-data"' : ""}>`
        + hidden
        + (files ? `<div class="w-composer-files" data-attachments></div>` : "")
        + `<div class="w-composer-box">`
        + (opts.above ? `<div class="w-composer-above">${opts.above}</div>` : "")
        + picker
        + `<textarea name="text" rows="1" aria-label="Message"${a("id", opts.inputId ?? (opts.id ? "input" : undefined))} placeholder="${esc(opts.placeholder ?? "Ask the agent…")}"${a("title", opts.hint)}></textarea>`
        + `<div class="w-composer-bar">${attach}<span class="w-composer-tools">${opts.tools ?? ""}</span><span class="w-composer-meters">${opts.meters ?? ""}</span><span class="w-composer-send">${send}</span></div>`
        + `</div></form>`;
}
