/**
 * Renders a consistent semantic card for chat lifecycle events
 *
 * Renders a compact theme-aware chat event card with icon, title, optional badge, body, details, link, and semantic tone. Use for plan, goal, wake, delegation, repair, and other non-message events in the agent transcript.
 * @param opts.title Visible event heading.
 * @param opts.body Trusted server-rendered event body HTML.
 * @param opts.icon Phosphor icon class without the ph prefix.
 * @param opts.tone Semantic visual tone. @default neutral
 * @param opts.badge Trusted compact badge HTML shown in the heading.
 * @param opts.href Optional internal destination that makes the whole card a link.
 * @param opts.details Trusted expandable details HTML.
 * @param opts.attrs Additional trusted HTML attributes on the outer card.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Visible event heading. */
        title: string;
        /** Trusted server-rendered event body HTML. */
        body?: string;
        /** Phosphor icon class without the ph prefix. */
        icon?: string;
        /** Semantic visual tone. @default neutral */
        tone?: "neutral" | "info" | "success" | "warning" | "error";
        /** Trusted compact badge HTML shown in the heading. */
        badge?: string;
        /** Optional internal destination that makes the whole card a link. */
        href?: string;
        /** Trusted expandable details HTML. */
        details?: string;
        /** Additional trusted HTML attributes on the outer card. */
        attrs?: string;
    },
): string {
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const tone = opts.tone ?? 'neutral';
    const tones = { neutral: 'border-ui-border bg-base-200/45 text-base-content', info: 'border-ui-border-strong bg-info/10 text-base-content', success: 'border-ui-border-strong bg-success/10 text-base-content', warning: 'border-ui-border-strong bg-warning/10 text-base-content', error: 'border-ui-border-strong bg-error/10 text-base-content' } as const;
    const iconTones = { neutral: 'text-subtle', info: 'text-info', success: 'text-success', warning: 'text-warning', error: 'text-error' } as const;
    const icon = opts.icon ? `<span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-base-100/70"><i class="ph ph-${esc(opts.icon)} ${iconTones[tone]}" aria-hidden="true"></i></span>` : '';
    const badge = opts.badge ? `<span class="ml-auto shrink-0">${opts.badge}</span>` : '';
    const content = `<div class="flex items-start gap-2 px-3 py-2">${icon}<div class="min-w-0 flex-1"><div class="flex min-h-6 items-center gap-2"><span class="min-w-0 flex-1 truncate text-xs font-semibold">${esc(opts.title)}</span>${badge}</div>${opts.body ? `<div class="mt-1 text-2xs leading-5 text-muted">${opts.body}</div>` : ''}${opts.details ? `<details class="mt-2"><summary class="cursor-pointer text-3xs font-medium text-muted hover:text-base-content">Details</summary><div class="mt-1">${opts.details}</div></details>` : ''}</div></div>`;
    const cls = `w-full overflow-hidden rounded-lg border ${tones[tone]}`;
    const attrs = opts.attrs ? ` ${opts.attrs}` : '';
    return opts.href ? `<a href="${esc(opts.href)}" class="block ${cls} !text-base-content transition hover:bg-base-200/70"${attrs}>${content}</a>` : `<div class="${cls}"${attrs}>${content}</div>`;
}
