/**
 * Renders a native modal dialog with header, body and footer, opened without inline scripts
 *
 * Use for create/edit forms and confirmations. Open it with any element carrying
 * `data-dialog-open="<id>"` (see `procs.ui.dialogButton`); any `[data-dialog-close]`
 * inside closes it, as do Escape and a backdrop click. When `post` is set the body
 * and footer are wrapped in a form that submits there with htmx and closes on success.
 * @param opts.id Dialog element id referenced by openers.
 * @param opts.title Dialog heading text.
 * @param opts.body Trusted inner HTML of the dialog body (fields, text).
 * @param opts.footer Trusted footer HTML; defaults to Cancel plus `submitLabel` when `post` is set.
 * @param opts.post Form action URL submitted with htmx; omitted renders no form.
 * @param opts.target htmx target selector for the form response. @default #main
 * @param opts.submitLabel Label of the default submit button. @default Save
 * @param opts.size Dialog width preset. @default md
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Dialog element id referenced by openers. */
    id: string;
    /** Dialog heading text. */
    title: string;
    /** Trusted inner HTML of the dialog body (fields, text). */
    body: string;
    /** Trusted footer HTML; defaults to Cancel plus `submitLabel` when `post` is set. */
    footer?: string;
    /** Form action URL submitted with htmx; omitted renders no form. */
    post?: string;
    /** htmx target selector for the form response. @default #main */
    target?: string;
    /** Label of the default submit button. @default Save */
    submitLabel?: string;
    /** Dialog width preset. @default md */
    size?: "md" | "lg";
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const ui = ctx.fns.procs.ui;
    const close = ui.button({ action: "close-dialog", html: '<i class="ph ph-x text-base" aria-hidden="true"></i>', tone: "ghost", size: "xs", ariaLabel: "Close", attrs: { "data-dialog-close": "" } });
    const footer = opts.footer ?? (opts.post
        ? ui.button({ action: "cancel", label: "Cancel", attrs: { "data-dialog-close": "" } })
          + ui.button({ action: "submit", label: opts.submitLabel ?? "Save", type: "submit", tone: "primary" })
        : "");
    const inner = `<div class="ui-dialog__body space-y-4">${opts.body}</div>${footer ? `<div class="ui-dialog__foot">${footer}</div>` : ""}`;
    const content = opts.post
        ? `<form method="POST" action="${esc(opts.post)}" hx-post="${esc(opts.post)}" hx-target="${esc(opts.target ?? "#main")}" hx-swap="innerHTML" data-dialog-form ${ui.attr({ form: opts.id })}>${inner}</form>`
        : inner;
    return `<dialog id="${esc(opts.id)}" class="ui-dialog${opts.size === "lg" ? " ui-dialog--lg" : ""}" aria-labelledby="${esc(opts.id)}-title" ${ui.attr({ section: opts.id })}>
  <div class="ui-dialog__head"><h2 id="${esc(opts.id)}-title" class="text-sm font-semibold">${esc(opts.title)}</h2>${close}</div>
  ${content}
</dialog>`;
}
