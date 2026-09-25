// Render secure input into the permanent application popup. Dynamic text is
// escaped; the secret itself only travels in the subsequent form POST.
/**
 * Renders the secure-input popup for an active prompt.
 * @param opts.prompt Prompt metadata to render.
 * @param opts.error Optional validation error.
 */
export default function (ctx: Context, _session: Session | null, opts: { prompt: any; error?: string }): string {
    const p = opts.prompt;
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? '') });
    const type = p.kind === 'password' ? 'password' : 'text';
    const otp = p.kind === 'otp';
    const form = `<form hx-popup="secureInput.submit" title="${esc(p.title)}" class="mt-4 space-y-4">
      <input type="hidden" name="id" value="${esc(p.id)}">
      <input name="value" type="${type}" required maxlength="${Number(p.maxlength ?? 256)}" ${otp ? 'inputmode="numeric" autocomplete="one-time-code" placeholder="12345"' : type === 'password' ? 'autocomplete="current-password"' : ''} class="input input-bordered mt-1 block w-full bg-base-100 text-base-content placeholder:text-faint focus:border-primary focus:outline-none ${otp ? 'font-mono tracking-[0.3em]' : ''}" autofocus>
      <div class="flex justify-end gap-2">
        ${ctx.fns.procs.ui.button({ action: 'cancel-secure-input', label: 'Cancel', type: 'button', tone: 'ghost', title: `Cancel ${p.title}`, attrs: { 'data-secure-cancel': true, 'hx-popup': 'secureInput.submit', 'hx-popup-params': JSON.stringify({ id: String(p.id), cancel: '1' }) } })}
        ${ctx.fns.procs.ui.button({ action: 'submit-secure-input', label: 'Submit', type: 'submit', tone: 'primary' })}
      </div><p id="secure-input-error" class="text-sm text-error">${esc(opts.error)}</p></form>`;
    return ctx.fns.ui.popupContent({ title: p.title, kind: 'secure-input', class: 'mx-auto w-full max-w-md', html: `<p class="text-sm text-subtle">${esc(p.message)}</p><p class="mt-1 font-mono text-3xs text-faint">${esc(p.name)}</p>${form}` });
}
