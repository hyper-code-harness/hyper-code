/**
 * Draws one chat message: the person's (a dark bubble on the right), the agent's (text right on the page),
 * another agent's (with its icon and name) or a system line — with attachments, time and the right-click menu id.
 * @param opts.role Who speaks.
 * @param opts.html Trusted body HTML (rendered markdown for agents, escaped text for people).
 * @param opts.author Name shown for people and other agents.
 * @param opts.avatar Trusted avatar HTML for people and other agents (w.avatar).
 * @param opts.ts Time of the message, ms since epoch.
 * @param opts.attachments Images and files under the text.
 * @param opts.menu Id of the context menu (w.menu with contextOf) for this message.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Who speaks. */
    role: "user" | "agent" | "peer" | "system";
    /** Trusted body HTML (rendered markdown for agents, escaped text for people). */
    html: string;
    /** Name shown for people and other agents. */
    author?: string;
    /** Trusted avatar HTML for people and other agents (w.avatar). */
    avatar?: string;
    /** Time of the message, ms since epoch. */
    ts?: number;
    /** Images and files under the text. */
    attachments?: Array<{ url: string; name: string; image?: boolean }>;
    /** Id of the context menu (w.menu with contextOf) for this message. */
    menu?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const time = opts.ts ? ctx.fns.w.time({ ts: opts.ts }) : "";
    const files = (opts.attachments ?? []).map(a => ({ ...a, url: ctx.fns.w.safeUrl({ url: a.url, image: !!a.image }) })).filter(a => a.url).map(a => a.image
        ? `<a class="w-attach-img" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`
        : `<a class="w-attach-file" href="${esc(a.url)}" target="_blank" rel="noopener">${ctx.fns.w.icon({ name: "file", size: 14 })}<span>${esc(a.name)}</span></a>`).join("");
    const author = opts.author && opts.role !== "agent" ? `<div class="w-msg-author">${esc(opts.author)}</div>` : "";
    return `<div class="w-msg" data-role="${opts.role}"${opts.menu ? ` data-menu="${esc(opts.menu)}"` : ""}>${opts.role === "peer" ? (opts.avatar ?? "") : ""}<div class="w-msg-body">${author}${files ? `<div class="w-msg-files">${files}</div>` : ""}<div class="w-msg-text">${opts.html}</div>${time ? `<div class="w-msg-meta">${time}</div>` : ""}</div>${opts.role === "user" ? (opts.avatar ?? "") : ""}</div>`;
}
