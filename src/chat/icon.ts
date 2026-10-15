/**
 * Draws a chat's icon: its own SVG, or the model logo when it has none.
 *
 * The one place that decides how a chat looks in a list — the chat header, Dock pins, the ⌘/ menu rows and
 * the ⋯ panel all call it, so a custom icon shows up everywhere at once. The SVG is drawn through an <img>
 * data URL, so even markup that slipped past cleaning cannot run.
 * @param opts.icon Stored icon SVG (agents.icon); empty draws the model logo.
 * @param opts.model Model id of the chat, drawn when the chat has no icon of its own.
 * @param opts.active The chat is running: a ring turns around the icon (the logo itself stays still).
 * @param opts.live Follow the chat's run state on the page instead of active: the ring shows while the
 *   chat header holds a running status (CSS :has), so it starts and stops without re-rendering the icon.
 * @param opts.size Drawn size: sm for lists and the Dock, md for the chat header, lg for the panel. @default "sm"
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Stored icon SVG (agents.icon); empty draws the model logo. */
        icon?: string | null;
        /** Model id of the chat, drawn when the chat has no icon of its own. */
        model?: string | null;
        /** The chat is running: a ring turns around the icon (the logo itself stays still). */
        active?: boolean;
        /** Follow the chat's run state on the page (chat header) instead of active. @default false */
        live?: boolean;
        /** Drawn size: sm for lists and the Dock, md for the chat header, lg for the panel. @default "sm" */
        size?: "sm" | "md" | "lg";
    },
): string {
    const size = opts.size ?? "sm";
    const icon = String(opts.icon ?? "").trim();
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
    const box = size === "lg" ? "size-12" : size === "md" ? "size-8" : "size-5";
    // Running: a ring turns around the face; the face itself stays still and readable.
    const ring = opts.active ? '<span class="chat-icon-ring" aria-hidden="true"></span>'
        : opts.live ? '<span class="chat-icon-ring chat-icon-ring--live" aria-hidden="true"></span>' : "";
    const label = opts.active ? ' aria-label="running"' : "";
    if (!icon) {
        const logo = ctx.fns.ui.modelLogo({ model: opts.model, bare: true, compact: size === "sm" });
        return `<span class="chat-icon relative inline-flex ${box} shrink-0 items-center justify-center"${label}>${logo}${ring}</span>`;
    }
    const src = "data:image/svg+xml," + encodeURIComponent(icon);
    return `<span class="chat-icon relative inline-flex ${box} shrink-0" title="${esc(opts.model ?? "")}"${label}><img src="${esc(src)}" alt="" class="${box} rounded-full object-contain" draggable="false">${ring}</span>`;
}
