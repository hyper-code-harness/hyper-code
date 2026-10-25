// Popup-local adapter over the shared w.button primitive. Keeping this
// tiny wrapper means no popup invents foreground/background classes again.
/** Renders a theme-safe shared button for LLM popups. */
/**
 * Render a shared UI button suitable for a popup form.
 * @param opts.action Stable semantic action name.
 * @param opts.label Visible button label.
 * @param opts.tone Shared button tone.
 * @param opts.class Additional layout classes, never colour classes.
 * @param opts.type Submit or plain button.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Stable semantic action name. */ action: string;
    /** Visible label. */ label: string;
    /** Shared component tone. @default "default" */ tone?: "default" | "primary" | "danger" | "ghost" | "success" | "warning" | "neutral";
    /** Additional layout-only classes. */ class?: string;
    /** Button type. @default "submit" */ type?: "submit" | "button";
}): string {
    const tone = opts.tone === "primary" || opts.tone === "danger" || opts.tone === "ghost" ? opts.tone : "neutral";
    const html = ctx.fns.w.button({ label: opts.label, tone, size: "sm", marks: { action: opts.action }, ...(opts.type === "button" ? {} : { submit: { name: "submit", value: "1" } }) });
    // Layout-only classes (w-full) go before the widget class, so the widget keeps owning the look.
    return opts.class ? html.replace('class="w-btn"', `class="${opts.class} w-btn"`) : html;
}
