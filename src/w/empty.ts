/**
 * Draws the one empty or error state: a quiet hero icon, a short title, an optional hint and one action.
 * Use it wherever a list, pane or page has nothing to show or failed to load, instead of ad-hoc text. Empty is quiet
 * grey; an error (tone danger) colours only the icon and the title red, never a fill. Lists draw it themselves when
 * their body is empty.
 * @param opts.title What is missing or what went wrong, in a few words, e.g. "No chats yet".
 * @param opts.icon Phosphor icon name without the ph- prefix; omit for none.
 * @param opts.hint One quiet sentence on what to do next.
 * @param opts.action Trusted HTML of one widget to act with, usually a w.button.
 * @param opts.tone danger for a failure: the icon and the title turn red. @default "neutral"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What is missing or what went wrong, in a few words, e.g. "No chats yet". */
    title: string;
    /** Phosphor icon name without the ph- prefix; omit for none. */
    icon?: string;
    /** One quiet sentence on what to do next. */
    hint?: string;
    /** Trusted HTML of one widget to act with, usually a w.button. */
    action?: string;
    /** danger for a failure: the icon and the title turn red. @default "neutral" */
    tone?: "neutral" | "danger";
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const icon = opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 24 }) : "";
    const hint = opts.hint ? `<div>${esc(opts.hint)}</div>` : "";
    const tone = opts.tone === "danger" ? ' data-tone="danger" role="alert"' : "";
    return `<div class="w-empty"${tone}>${icon}<div class="w-empty-title">${esc(opts.title)}</div>${hint}${opts.action ?? ""}</div>`;
}
