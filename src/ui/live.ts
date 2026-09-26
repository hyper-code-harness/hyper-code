// A LIVE REGION: a fragment that re-fetches itself when the server says its
// topic changed.
//
// The whole contract is three attributes — where to re-fetch, which topic to
// watch, and how rarely to check anyway. There is no cursor and no client-side
// bookkeeping: the server sends "refresh agent:eh", the shared client re-asks
// for the regions carrying that topic, and the answer replaces them. Nothing
// can drift out of sync because nothing is remembered.
//
// The interval is a WATCHDOG, not the mechanism: it repairs a signal missed
// while the connection was down. Five seconds is the floor — a widget that
// wants a hot loop is asking for the wrong thing.
//
// The target is stated, never inherited. htmx passes hx-target down to every
// descendant, so a live region rendered inside a page pane that carries
// `hx-target="#main"` for its boosted links would answer its own poll by
// replacing the whole pane — the region eats the page that contains it. Saying
// "this" out loud costs one attribute and cannot be broken from above.
/** Performs the ui.live runtime operation. */
/**
 * A LIVE REGION: a fragment that re-fetches itself when the server says its.
 * @param opts.id Stable DOM region identifier.
 * @param opts.url URL to fetch or connect to.
 * @param opts.topic Live-update topic to subscribe to.
 * @param opts.html Initial or inner HTML content.
 * @param opts.every Fallback refresh interval in milliseconds.
 * @param opts.attrs Additional HTML attributes.
 * @param opts.tag HTML element name for the live region.
 * @param opts.swap HTMX swap strategy.
 * @param opts.trigger HTMX trigger expression.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Identifier of the target agent. */ id: string;
        /** Endpoint URL. */ url: string;
        /** Value used for the topic option. */ topic: string;
        /** Rendered HTML content. */ html?: string;
        /** Value used for the every option. Set 0 to disable the watchdog for editable regions. */ every?: number;
        /** Value used for the attrs option. */ attrs?: string;
        /** Value used for the tag option. */ tag?: string;
        /** Value used for the swap option. */ swap?: string;
        /** HTML for the popup trigger. */ trigger?: string },
): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const every = opts.every === 0 ? 0 : Math.max(5, opts.every ?? 30);
    const tag = /^[a-z][a-z0-9-]*$/i.test(opts.tag ?? '') ? opts.tag! : 'div';
    const swap = opts.swap ?? 'outerHTML';
    // `hyper-live` is dispatched on the region itself, without bubbling. With
    // `from:body` every region on the page answered every topic: one usage
    // signal re-fetched the status bar, the stop button and the transcript too.
    const trigger = [opts.trigger, 'hyper-live', every ? `every ${every}s` : ''].filter(Boolean).join(', ');
    // A caller may aim its region somewhere else; only fill in the default when
    // it did not, because the first attribute of a name is the one that counts.
    const target = /\bhx-target\s*=/.test(opts.attrs ?? "") ? "" : ` hx-target="this"`;
    return `<${tag} id="${esc(opts.id)}"`
        + ` hx-get="${esc(opts.url)}"`
        + ` hx-trigger="${esc(trigger)}"`
        + ` hx-swap="${esc(swap)}"`
        + target
        + ` data-live-topic="${esc(opts.topic)}"`
        + `${opts.attrs ? " " + opts.attrs : ""}>${opts.html ?? ""}</${tag}>`;
}
