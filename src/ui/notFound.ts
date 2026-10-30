/**
 * Draws Hyper's 404 page on w for an address nothing answers
 *
 * Returns a page value (title, status 404, main) that procs.http.toResponse dresses in the app layout on a full load or as a fragment under htmx: a large quiet "404", the title ("Page not found" or "There is no <what>"), the requested address in monospace, a row of ways out (Back through the browser history, an optional caller-given way back, Home) and two short link lists — the most recent chats and the pages of `@view` functions. The HTTP layer calls it for every miss that asks for HTML; use it from a route when a looked-up thing (a file, an agent, a task) does not exist.
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
    const esc = (v: unknown) => w.escape({ text: String(v ?? "") });
    const what = opts.what?.trim();
    const title = what ? `There is no ${what}` : "Page not found";

    // Ways out, in the order a person reaches for them: where I came from, what the caller suggests, home.
    const buttons = [
        w.button({ label: "Back", icon: "arrow-left", tone: "ghost", marks: { action: "go-back", id: "not-found" }, attrs: { onclick: "history.length>1?history.back():location.assign('/')" } }),
        opts.back ? w.button({ label: opts.back.label, icon: "arrow-bend-up-left", action: { href: opts.back.href }, marks: { action: "back", id: "not-found" } }) : "",
        w.button({ label: "Home", icon: "house", tone: "primary", action: { href: "/" }, marks: { action: "home", id: "not-found" } }),
    ].join("");

    // Somewhere to go instead: recent chats and the pages that open by address. Either list failing (no db in a
    // bare test ctx, a broken index) only drops that list — a 404 page must never become a 500.
    const [chats, views] = await Promise.all([
        ctx.fns.session.list({}).then(list => list.slice(0, 5)).catch(() => []),
        ctx.fns.runtime.docs.search({ tag: "view", limit: 50 } as any).catch(() => [] as any[]),
    ]);
    const chatRows = chats.map((a: any) => w.listRow({ label: a.title || a.id, meta: `(${a.id})`, icon: "chat-circle", action: { href: `/agent/${encodeURIComponent(a.id)}` } })).join("")
        + w.listRow({ label: "New chat", icon: "plus", tone: "primary", action: { href: "/agent/new" } });
    // Only views that open without arguments: a page that needs an id cannot be linked from nowhere.
    const openable = (views as any[]).filter(v => {
        const req = ctx.fns.runtime.docs.get({ name: v.name })?.paramsSchema?.required;
        return !Array.isArray(req) || req.length === 0;
    }).slice(0, 6);
    const viewRows = openable.map((v: any) => w.listRow({ label: v.name, detail: String(v.summary ?? "").replace(/ as a page$/, ""), icon: "browser", action: { href: `/rpc/${encodeURIComponent(v.name)}` } })).join("")
        + w.listRow({ label: "All functions", icon: "book-open", action: { href: "/functions" } });
    const lists = w.columns({ body: w.listSection({ title: "Recent chats", rows: chatRows }) + w.listSection({ title: "Pages", rows: viewRows }) });

    const hero = `<div class="nf-hero">${w.icon({ name: "compass", size: 24 })}<div class="nf-code" aria-hidden="true">404</div>`
        + `<h1 class="nf-title">${esc(title)}</h1>`
        + (opts.url ? `<code class="nf-url">${esc(opts.url)}</code>` : "")
        + `<p class="nf-lead">The address may be mistyped, or what was here has moved or been removed.</p>`
        + `<div class="nf-actions">${buttons}</div></div>`;
    const body = `<div class="nf">${hero}<div class="nf-lists">${lists}</div></div>`;
    return { title: "Not found", status: 404, main: w.page({ page: "not-found", body }) };
}
