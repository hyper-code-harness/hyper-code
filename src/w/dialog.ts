/**
 * Draws a modal dialog on the native <dialog> element: a title row with a close button, a body and an optional
 * footer. With `post` the body becomes an htmx form, the footer gets Cancel and a submit button, and the dialog
 * closes itself after a successful answer. Open it with w.dialogOpener (or any element with data-dialog-open);
 * use it for a short form that creates something without leaving the page.
 * @param opts.id Dialog id; openers point at it.
 * @param opts.title Title text (escaped).
 * @param opts.body Trusted HTML of the content (w.field rows).
 * @param opts.footer Trusted HTML replacing the default footer.
 * @param opts.post URL the form posts to; omit for a dialog that only shows something.
 * @param opts.target htmx target of the form answer.
 * @param opts.submitLabel Label of the submit button.
 * @param opts.size Width of the dialog.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Dialog id; openers point at it. */
    id: string;
    /** Title text (escaped). */
    title: string;
    /** Trusted HTML of the content (w.field rows). */
    body: string;
    /** Trusted HTML replacing the default footer. */
    footer?: string;
    /** URL the form posts to; omit for a dialog that only shows something. */
    post?: string;
    /** htmx target of the form answer. @default "#main" */
    target?: string;
    /** Label of the submit button. @default "Save" */
    submitLabel?: string;
    /** Width of the dialog. @default "md" */
    size?: "md" | "lg";
}): string {
    const w = ctx.fns.w;
    const esc = (v: unknown) => w.escape({ text: v });
    const id = String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    const close = w.iconButton({ icon: "x", label: "Close", attrs: { "data-dialog-close": "" } });
    const footer = opts.footer ?? (opts.post
        ? w.button({ label: "Cancel", tone: "ghost", marks: { action: "cancel" }, attrs: { "data-dialog-close": "" } })
          + w.button({ label: opts.submitLabel ?? "Save", tone: "primary", submit: true, marks: { action: "submit" } })
        : "");
    const inner = `<div class="w-dialog-body">${opts.body}</div>${footer ? `<div class="w-dialog-foot">${footer}</div>` : ""}`;
    const content = opts.post
        ? `<form method="POST" action="${esc(opts.post)}" hx-post="${esc(opts.post)}" hx-target="${esc(opts.target ?? "#main")}" hx-swap="innerHTML" data-dialog-form ${w.marks({ form: id })}>${inner}</form>`
        : inner;
    return `<dialog id="${id}" class="w-dialog" data-size="${opts.size ?? "md"}" aria-labelledby="${id}-title" ${w.marks({ section: id })}><div class="w-dialog-head"><h2 id="${id}-title" class="w-dialog-title">${esc(opts.title)}</h2>${close}</div>${content}</dialog>`;
}
