/**
 * Draws Hyper's 404 page on w for an address nothing answers
 *
 * Returns a page value (title, status 404, main) that procs.http.toResponse dresses in the app layout on a full load or as a fragment under htmx: a w.empty saying what was not found, the address in monospace under it and an optional way back as a w.button. The HTTP layer calls it for every miss that asks for HTML; use it from a route when a looked-up thing (a file, an agent, a task) does not exist.
 * @param opts.what The thing that was looked for, in the words of whoever looked ("agent xy", "file notes/a.md"); omit for a plain address miss.
 * @param opts.url The address that was asked for, shown under the title.
 * @param opts.back A way back: the button label and the address it opens.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** The thing that was looked for, in the words of whoever looked ("agent xy", "file notes/a.md"); omit for a plain address miss. */
        what?: string;
        /** The address that was asked for, shown under the title. */
        url?: string;
        /** A way back: the button label and the address it opens. */
        back?: { label: string; href: string };
    },
): Promise<{ title: string; status: number; main: string }> {
    const w = ctx.fns.w;
        const what = opts.what?.trim();
        const back = opts.back;
        const action = back ? w.button({ label: back.label, icon: "arrow-left", tone: "ghost", action: { href: back.href }, marks: { action: "back", id: "not-found" } }) : undefined;
        // Title, the address asked for (the hint), then the way back — the order a person reads them in.
    const body = w.box({ mix: { layout: "stack", align: "center", pad: "s6" }, body:
        w.empty({ icon: "compass", title: what ? `There is no ${what}` : "There is nothing at this address", ...(opts.url ? { hint: opts.url } : {}), ...(action ? { action } : {}) }) });
    return { title: "Not found", status: 404, main: w.page({ page: "not-found", body }) };
}
