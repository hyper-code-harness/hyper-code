/**
 * Renders one rich list row: status icon, linked title, badges, preview and metadata
 *
 * Use inside `procs.ui.listPage` for issue-, task- or message-like records that
 * need more than table cells. The row carries entity/id/status markers so the
 * workspace can point at it; `href` makes the title an htmx link into `#main`.
 * @param opts.entity Entity type marker, such as `task`.
 * @param opts.id Entity identifier marker.
 * @param opts.status Entity status marker.
 * @param opts.href Detail URL opened from the title.
 * @param opts.icon Phosphor icon class for the leading status icon.
 * @param opts.tone Semantic color of the leading icon. @default neutral
 * @param opts.title Row title text.
 * @param opts.badges Trusted badge HTML rendered after the title.
 * @param opts.text Secondary preview line (plain text, truncated).
 * @param opts.meta Metadata parts joined with " · " (plain text).
 * @param opts.right Trusted trailing HTML such as an icon link.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Entity type marker, such as `task`. */
    entity: string;
    /** Entity identifier marker. */
    id: string;
    /** Entity status marker. */
    status?: string;
    /** Detail URL opened from the title. */
    href?: string;
    /** Phosphor icon class for the leading status icon. */
    icon?: string;
    /** Semantic color of the leading icon. @default neutral */
    tone?: "neutral" | "info" | "success" | "warning" | "danger";
    /** Row title text. */
    title: string;
    /** Trusted badge HTML rendered after the title. */
    badges?: string;
    /** Secondary preview line (plain text, truncated). */
    text?: string;
    /** Metadata parts joined with " · " (plain text). */
    meta?: string[];
    /** Trusted trailing HTML such as an icon link. */
    right?: string;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const tones = { neutral: "text-faint", info: "text-info", success: "text-success", warning: "text-warning", danger: "text-error" } as const;
    const title = opts.href
        ? `<a href="${esc(opts.href)}" hx-get="${esc(opts.href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true" class="ui-focusable font-semibold text-base-content hover:text-primary hover:underline" ${ctx.fns.procs.ui.attr({ role: "title" })}>${esc(opts.title)}</a>`
        : `<span class="font-semibold" ${ctx.fns.procs.ui.attr({ role: "title" })}>${esc(opts.title)}</span>`;
    return `<div class="flex gap-3 border-t border-ui-border px-4 py-3 first:border-t-0 hover:bg-base-200" ${ctx.fns.procs.ui.attr({ entity: opts.entity, id: opts.id, status: opts.status })}>
  ${opts.icon ? `<i class="ph ${esc(opts.icon)} mt-0.5 text-xl ${tones[opts.tone ?? "neutral"]}" aria-hidden="true"></i>` : ""}
  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-center gap-2">${title}${opts.badges ?? ""}</div>
    ${opts.text ? `<p class="mt-1 truncate text-sm text-subtle" ${ctx.fns.procs.ui.attr({ role: "text" })}>${esc(opts.text)}</p>` : ""}
    ${opts.meta?.length ? `<p class="mt-1 text-xs text-faint" ${ctx.fns.procs.ui.attr({ role: "meta" })}>${opts.meta.map(esc).join(" · ")}</p>` : ""}
  </div>
  ${opts.right ?? ""}
</div>`;
}
