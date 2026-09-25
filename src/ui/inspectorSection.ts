/**
 * Renders a reusable section for compact inspector side panels
 *
 * Renders a semantic, theme-aware inspector section with an optional collapsible summary, icon, badge, actions, and empty-state copy. Use for dense side-panel groups such as agent status, plans, teams, scheduling, and settings.
 * @param opts.title Visible section heading.
 * @param opts.html Trusted server-rendered HTML placed in the section body.
 * @param opts.icon Phosphor icon class name without the ph prefix, such as list-checks.
 * @param opts.badge Trusted compact HTML displayed after the title.
 * @param opts.actions Trusted action HTML aligned to the end of the heading.
 * @param opts.collapsible Render the section as details and summary when true. @default false
 * @param opts.open Initially expand a collapsible section. @default false
 * @param opts.empty Empty-state text used when html is blank.
 * @param opts.className Additional trusted utility classes for the outer element.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Visible section heading. */
        title: string;
        /** Trusted server-rendered HTML placed in the section body. */
        html: string;
        /** Phosphor icon class name without the ph prefix, such as list-checks. */
        icon?: string;
        /** Trusted compact HTML displayed after the title. */
        badge?: string;
        /** Trusted action HTML aligned to the end of the heading. */
        actions?: string;
        /** Render the section as details and summary when true. @default false */
        collapsible?: boolean;
        /** Initially expand a collapsible section. @default false */
        open?: boolean;
        /** Empty-state text used when html is blank. */
        empty?: string;
        /** Additional trusted utility classes for the outer element. */
        className?: string;
    },
): string {
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const icon = opts.icon ? `<i class="ph ph-${esc(opts.icon)} text-base text-muted" aria-hidden="true"></i>` : '';
    const badge = opts.badge ? `<span class="shrink-0">${opts.badge}</span>` : '';
    const actions = opts.actions ? `<span class="ml-auto flex shrink-0 items-center gap-1">${opts.actions}</span>` : '';
    const heading = `${icon}<span class="min-w-0 flex-1 truncate text-xs font-semibold text-base-content">${esc(opts.title)}</span>${badge}${actions}`;
    const content = opts.html.trim() || (opts.empty ? `<p class="text-xs leading-5 text-subtle">${esc(opts.empty)}</p>` : '');
    const body = `<div class="border-t border-ui-border bg-transparent px-3 py-3">${content}</div>`;
    const extra = opts.className ? ` ${opts.className}` : '';
    if (opts.collapsible) return `<details ${opts.open ? 'open' : ''} class="group border-b border-ui-border bg-transparent${extra}"><summary class="flex min-h-10 cursor-pointer list-none items-center gap-2 bg-base-100/25 px-3 py-2 hover:bg-base-100/45">${heading}<i class="ph ph-caret-down text-3xs text-faint transition-transform group-open:rotate-180" aria-hidden="true"></i></summary>${body}</details>`;
    return `<section class="border-b border-ui-border bg-transparent${extra}"><div class="flex min-h-10 items-center gap-2 bg-base-100/25 px-3 py-2">${heading}</div>${body}</section>`;
}
