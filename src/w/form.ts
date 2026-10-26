/**
 * Draws a form that submits through htmx (hx-post or hx-get) into a target, with the data-form marker that
 * page.fill / page.submit address it by. The fields and buttons inside are trusted HTML (w.field, w.input,
 * w.button with submit). layout row puts controls on one line; stack puts fields one under another.
 * @param opts.form Form name for the data-form marker.
 * @param opts.body Trusted HTML of the fields and buttons.
 * @param opts.post URL to POST the fields to; give post or get.
 * @param opts.get URL to GET with the fields as the query; give post or get.
 * @param opts.target Selector of the element the answer swaps into. @default "#main"
 * @param opts.swap How the answer is swapped in. @default "innerHTML"
 * @param opts.push Put the request URL in the address bar (history), for a filter form.
 * @param opts.trigger htmx trigger, e.g. "change" for a filter that applies itself.
 * @param opts.layout Arrangement of the children. @default "row"
 * @param opts.id Element id.
 * @param opts.confirm Ask before sending (htmx confirm).
 * @param opts.vals Fixed values sent with the form (htmx hx-vals), instead of hidden inputs.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Form name for the data-form marker. */
    form: string;
    /** Trusted HTML of the fields and buttons. */
    body: string;
    /** URL to POST the fields to; give post or get. */
    post?: string;
    /** URL to GET with the fields as the query; give post or get. */
    get?: string;
    /** Selector of the element the answer swaps into. @default "#main" */
    target?: string;
    /** How the answer is swapped in. @default "innerHTML" */
    swap?: "none" | "innerHTML" | "outerHTML" | "beforeend" | "afterbegin" | "beforebegin" | "afterend";
    /** Put the request URL in the address bar (history), for a filter form. */
    push?: boolean;
    /** htmx trigger, e.g. "change" for a filter that applies itself. */
    trigger?: string;
    /** Arrangement of the children. @default "row" */
    layout?: "row" | "stack";
    /** Element id. */
    id?: string;
    /** Fixed values sent with the form (htmx hx-vals), instead of hidden inputs. */
    vals?: Record<string, string | number | boolean>;
    /** Ask before sending (htmx confirm). */
    confirm?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    if (!!opts.post === !!opts.get) throw new Error("w.form needs exactly one of post or get");
    const hx = opts.post ? `hx-post="${esc(opts.post)}"` : `hx-get="${esc(opts.get)}"`;
    return `<form class="w-form" data-layout="${opts.layout ?? "row"}" ${ctx.fns.w.marks({ form: opts.form })}${opts.id ? ` id="${esc(opts.id)}"` : ""} ${hx} hx-target="${esc(opts.target ?? "#main")}" hx-swap="${opts.swap ?? "innerHTML"}"${opts.push ? ' hx-push-url="true"' : ""}${opts.vals ? ` hx-vals="${esc(JSON.stringify(opts.vals))}"` : ""}${opts.confirm ? ` hx-confirm="${esc(opts.confirm)}"` : ""}${opts.trigger ? ` hx-trigger="${esc(opts.trigger)}"` : ""}>${opts.body}</form>`;
}
