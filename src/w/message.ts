/**
 * Draws one chat message: the person's (a dark bubble on the right), the agent's (Markdown right on the page),
 * another agent's (with its icon and name) or a system line — with attachments, time, quiet marks after the time
 * and its own right-click menu (w.menu with contextOf: copy the text, delete, …).
 * @param opts.role Who speaks.
 * @param opts.html Trusted body HTML (rendered markdown for agents, escaped text for people).
 * @param opts.id Element id of the message (e.g. m-12): the chat scrolls to it and its right-click menu is bound to it.
 * @param opts.author Name shown for people and other agents.
 * @param opts.authorHref The author's name links here (another agent's chat).
 * @param opts.meta Quiet text after the name (hop count, on whose behalf).
 * @param opts.avatar Trusted avatar HTML for people and other agents (w.avatar).
 * @param opts.ts Time of the message, ms since epoch.
 * @param opts.trail Trusted HTML of quiet marks after the time (w.dot, w.tooltip).
 * @param opts.attachments Images and files under the text.
 * @param opts.actions Items of the message's right-click menu (w.menu items); { action: "copy-text" } copies the message text. Needs id.
 * @param opts.marks Automation markers on the message (w.marks), e.g. { "agent-message": "at" }.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Who speaks. */
    role: "user" | "agent" | "peer" | "system";
    /** Trusted body HTML (rendered markdown for agents, escaped text for people). */
    html: string;
    /** Element id of the message (e.g. m-12): the chat scrolls to it and its right-click menu is bound to it. */
    id?: string;
    /** Name shown for people and other agents. */
    author?: string;
    /** The author's name links here (another agent's chat). */
    authorHref?: string;
    /** Quiet text after the name (hop count, on whose behalf). */
    meta?: string;
    /** Trusted avatar HTML for people and other agents (w.avatar). */
    avatar?: string;
    /** Time of the message, ms since epoch. */
    ts?: number;
    /** Trusted HTML of quiet marks after the time (w.dot, w.tooltip). */
    trail?: string;
    /** Images and files under the text. */
    attachments?: Array<{ url: string; name: string; image?: boolean }>;
    /** Items of the message's right-click menu (w.menu items); { action: "copy-text" } copies the message text. Needs id. */
    actions?: Array<"-" | { label: string; icon?: string; keys?: string; action?: types.w.Action; danger?: boolean }>;
    /** Automation markers on the message (w.marks), e.g. { "agent-message": "at" }. */
    marks?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const id = opts.id ? String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-") : "";
    const time = opts.ts ? ctx.fns.w.time({ ts: opts.ts }) : "";
    const files = (opts.attachments ?? []).map(a => ({ ...a, url: ctx.fns.w.safeUrl({ url: a.url, image: !!a.image }) })).filter(a => a.url).map(a => a.image
        ? `<a class="w-attach-img" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`
        : `<a class="w-attach-file" href="${esc(a.url)}" target="_blank" rel="noopener">${ctx.fns.w.icon({ name: "file", size: 14 })}<span>${esc(a.name)}</span></a>`).join("");
    const href = opts.authorHref ? ctx.fns.w.safeUrl({ url: opts.authorHref }) : "";
    const name = href ? `<a href="${esc(href)}">${esc(opts.author)}</a>` : esc(opts.author);
    const author = opts.author && opts.role !== "agent"
        ? `<div class="w-msg-author" data-no-copy>${name}${opts.meta ? `<span class="w-msg-author-meta">${esc(opts.meta)}</span>` : ""}</div>`
        : "";
    // Telegram-style: the marks and the time sit at the end of the last line of text, not on a row of their own;
    // inside the final paragraph when the text ends with one, so they share its line.
    const meta = time || opts.trail ? `<span class="w-msg-meta" data-no-copy>${opts.trail ?? ""}${time}</span>` : "";
    const body = /<\/p>\s*$/.test(opts.html) ? opts.html.replace(/<\/p>\s*$/, `${meta}</p>`) : opts.html + meta;
    const text = opts.role === "agent"
        ? `<div class="w-msg-text w-markdown" data-size="regular" data-copy-text>${body}</div>`
        : `<div class="w-msg-text" data-copy-text>${body}</div>`;
    const menu = id && opts.actions?.length ? ctx.fns.w.menu({ id: `${id}-menu`, label: "Message actions", contextOf: `#${id}`, items: opts.actions }) : "";
    const marks = opts.marks ? ctx.fns.w.marks(opts.marks) : "";
    return `<div${id ? ` id="${id}"` : ""} class="w-msg" data-role="${opts.role}"${marks ? " " + marks : ""}>${opts.role === "peer" ? (opts.avatar ?? "") : ""}<div class="w-msg-body">${author}${files ? `<div class="w-msg-files">${files}</div>` : ""}${text}</div>${opts.role === "user" ? (opts.avatar ?? "") : ""}${menu}</div>`;
}
