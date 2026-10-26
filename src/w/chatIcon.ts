/**
 * Draws a chat's icon: its own SVG, or the model logo when it has none.
 *
 * The w widget for a chat's face. The one place that decides how a chat looks in a list — the chat header, Dock pins, the ⌘/ menu rows and
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
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    // Running: a ring turns around the face; the face itself stays still and readable.
    const ring = opts.active ? '<span class="w-chat-icon-ring" aria-hidden="true"></span>'
        : opts.live ? '<span class="w-chat-icon-ring" data-live aria-hidden="true"></span>' : "";
    const open = (extra = "") => `<span class="w-chat-icon" data-size="${size}"${extra}${label}>`;
    const label = opts.active ? ' aria-label="running"' : "";
    if (!icon) {
        const logo = ctx.fns.ui.modelLogo({ model: opts.model, bare: true, compact: size === "sm" });
        return `${open()}${logo}${ring}</span>`;
    }
    // A line icon drawn in currentColor (the Lucide-style ones from the icon picker) is inlined so it takes the
    // page's text colour — through <img> currentColor is always black and vanished in the dark theme. Only a
    // clean <svg> without scripts, handlers, foreignObject or external references is inlined; anything else
    // (pictures, emoji avatars) stays an <img>.
    const inlineable = /^<svg[\s>]/i.test(icon) && /currentColor/.test(icon)
        && !/<script|<foreignObject|\son\w+\s*=|javascript:|(?:href|src)\s*=\s*["'](?!#)/i.test(icon);
    if (inlineable) {
        const svg = icon.replace(/^<svg\b/i, `<svg aria-hidden="true" focusable="false"`).replace(/\s(width|height)="[^"]*"/g, (m, _k, off) => off < icon.indexOf(">") ? "" : m);
        return `${open(` data-kind="line" title="${esc(opts.model ?? "")}"`)}${svg}${ring}</span>`;
    }
    const src = "data:image/svg+xml," + encodeURIComponent(icon);
    return `${open(` title="${esc(opts.model ?? "")}"`)}<img src="${esc(src)}" alt="" draggable="false">${ring}</span>`;
}
