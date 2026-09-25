/** Performs the ui.toggle runtime operation. */
/**
 * Render a labeled boolean toggle control.
 * @param opts.name Registered action or input name.
 * @param opts.enabled Current toggle value.
 * @param opts.label Visible control label.
 * @param opts.hint Supplementary help text.
 * @param opts.compact Whether to use compact presentation.
 * @param opts.title Displayed title.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Name of the requested action or resource. */ name: string;
        /** Value used for the enabled option. */ enabled: boolean;
        /** Value used for the label option. */ label?: string;
        /** Value used for the hint option. */ hint?: string;
        /** Whether to render the compact variant. */ compact?: boolean;
        /** Page title. */ title?: string },
): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const text = opts.label ? `<span class="min-w-0 flex-1"><span class="block ${opts.compact ? 'text-2xs font-medium leading-4' : 'text-xs font-medium leading-4'} ${opts.enabled ? 'text-muted' : 'text-subtle'}">${esc(opts.label)}</span>${opts.hint ? `<span class="block text-micro leading-3.5 text-faint">${esc(opts.hint)}</span>` : ''}</span>` : '';
    const track = opts.enabled ? 'background:rgb(99 102 241)' : 'background:rgb(229 231 235)';
    const thumb = opts.enabled ? 'left:22px' : 'left:2px';
    return `<label class="flex min-h-8 cursor-pointer items-center gap-2"${opts.title ? ` title="${esc(opts.title)}"` : ''}>${text}<input name="${esc(opts.name)}" type="checkbox" value="1" ${opts.enabled ? 'checked' : ''} class="ui-toggle-input sr-only" onchange="this.nextElementSibling.style.background=this.checked?'rgb(99 102 241)':'rgb(229 231 235)';this.nextElementSibling.firstElementChild.style.left=this.checked?'22px':'2px'"><span class="ui-toggle-track" style="${track}" aria-hidden="true"><span class="ui-toggle-thumb" style="${thumb}"></span></span></label>`;
}
