// Render secure input into the permanent application popup. Dynamic text is
// escaped; the secret itself only travels in the subsequent form POST.
/**
 * Renders the secure-input popup for an active prompt.
 * @param opts.prompt Prompt metadata to render.
 * @param opts.error Optional validation error.
 */
export default function (ctx: Context, _session: Session | null, opts: { prompt: any; error?: string }): string {
    const p = opts.prompt;
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? '') });
    const otp = p.kind === 'otp';
    const w = ctx.fns.w;
    // All w: the field as w.field + w.input (error under it),
    // Cancel / Submit as w.button. The <form> only carries the popup RPC hook; it has no look of its own.
    const input = w.input({
        name: 'value', type: p.kind === 'password' ? 'password' : 'text', required: true, maxlength: Number(p.maxlength ?? 256), label: p.title,
        ...(otp ? { inputmode: 'numeric' as const, autocomplete: 'one-time-code', placeholder: '12345', mono: true } : p.kind === 'password' ? { autocomplete: 'current-password' } : {}),
        invalid: !!opts.error, describedBy: 'secure-input-error',
    });
    // The popup header already says the title: the field's label is the message, the secret's name is its quiet note.
    const field = w.field({ name: 'value', label: p.message || p.title, note: p.name || undefined, control: input, error: opts.error || undefined, errorId: 'secure-input-error' });
    const buttons = w.box({ mix: { layout: 'row', gap: 's2', justify: 'end' }, body:
        w.button({ label: 'Cancel', size: 'sm', tone: 'ghost', title: `Cancel ${p.title}`, action: { popup: { method: 'secureInput.submit', params: { id: String(p.id), cancel: '1' } } }, marks: { action: 'cancel-secure-input' } }).replace('<button', '<button data-secure-cancel')
        + w.button({ label: 'Submit', size: 'sm', tone: 'primary', submit: true, marks: { action: 'submit-secure-input' } }) });
    const form = `<form hx-popup="secureInput.submit" title="${esc(p.title)}"><input type="hidden" name="id" value="${esc(p.id)}">${w.box({ mix: { layout: 'stack', gap: 's4' }, body: field + buttons })}</form>`;
    return ctx.fns.ui.popupContent({ title: p.title, kind: 'secure-input', class: '', html: form });
}
