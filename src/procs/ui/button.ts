// The single shared renderer for clickable controls and action-styled links.
// Feature renderers describe semantics; all visual variants are owned here.
const TONE = {
    default: "ui-button--default", primary: "ui-button--primary", danger: "ui-button--danger",
    ghost: "ui-button--ghost", success: "ui-button--success", warning: "ui-button--warning", neutral: "ui-button--neutral",
} as const;

const SIZE = { xs: "ui-button--xs", sm: "ui-button--sm", md: "ui-button--md", lg: "ui-button--lg" } as const;

/**
 * Render the shared application button component.
 *
 * Use this for submit buttons, client actions, htmx actions, and links that look
 * like buttons. Feature code must not own visual button classes.
 *
 * @param opts.action Stable semantic action name used by UI automation.
 * @param opts.label Visible text; required unless html supplies accessible content.
 * @param opts.html Trusted component-owned inner HTML, typically an icon plus escaped text.
 * @param opts.href Render an anchor button pointing to this URL.
 * @param opts.element Render a disclosure summary instead of a native button. @default "button"
 * @param opts.appearance Render either the standard visual button or a semantic plain control. @default "button"
 * @param opts.type Native button type. @default "button", or "submit" when name is set.
 * @param opts.entity Entity kind used by UI automation.
 * @param opts.id Entity identifier used by UI automation.
 * @param opts.uiRole Semantic UI role used by automation, distinct from the ARIA role attribute.
 * @param opts.status Semantic UI status used by automation.
 * @param opts.active Apply the selected/active visual state.
 * @param opts.post htmx POST URL.
 * @param opts.get htmx GET URL.
 * @param opts.vals htmx values serialized as JSON.
 * @param opts.target htmx target selector. @default "#main"
 * @param opts.swap htmx swap strategy. @default "innerHTML"
 * @param opts.tone Visual semantic tone. @default "default"
 * @param opts.size Component size. @default "sm"
 * @param opts.title Accessible tooltip text.
 * @param opts.ariaLabel Accessible label for icon-only controls.
 * @param opts.disabled Disable the control.
 * @param opts.name Submitted field name.
 * @param opts.value Submitted field value. @default "1"
 * @param opts.class Layout-only utility classes; visual styling belongs to the component.
 * @param opts.attrs Additional safe HTML attributes needed by platform integrations.
 * @deprecated use w.button (text) or w.iconButton (icon only); automation markers go in marks
 */
export default function (ctx: Context, _session: Session | null, opts: {
    action?: string; label?: string; html?: string; href?: string; element?: "button" | "summary"; appearance?: "button" | "plain";
    type?: "submit" | "button" | "reset"; entity?: string; id?: string; uiRole?: string; status?: string; active?: boolean;
    post?: string; get?: string; vals?: Record<string, any>; target?: string; swap?: string;
    tone?: keyof typeof TONE; size?: keyof typeof SIZE; title?: string; ariaLabel?: string;
    disabled?: boolean; name?: string; value?: string; class?: string;
    attrs?: Record<string, string | number | boolean | undefined>;
}): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: String(s ?? "") });
    const attr = (name: string, value: string | number | boolean | undefined) => {
        if (value === undefined || value === false) return "";
        if (value === true) return ` ${name}`;
        return ` ${name}="${esc(value)}"`;
    };
    const extra = Object.entries(opts.attrs ?? {}).map(([name, value]) => {
        if (!/^(?:data-[a-z0-9_:-]+|aria-[a-z0-9_:-]+|hx-[a-z0-9_:-]+|onclick|style|id|form|formaction|formmethod|popovertarget|popovertargetaction|role|target|rel)$/.test(name)) {
            throw new Error(`Unsupported button attribute: ${name}`);
        }
        return attr(name, value);
    }).join("");
    const hx = opts.post ? attr("hx-post", opts.post) : opts.get ? attr("hx-get", opts.get) : "";
    const vals = opts.vals ? attr("hx-vals", JSON.stringify(opts.vals)) : "";
    const htmx = hx ? `${hx}${attr("hx-target", opts.target ?? "#main")}${attr("hx-swap", opts.swap ?? "innerHTML")}` : "";
    const content = opts.html ?? esc(opts.label ?? "");
    const classes = opts.appearance === "plain"
        ? opts.class ?? ""
        : `ui-button ${SIZE[opts.size ?? "sm"]} ${TONE[opts.tone ?? "default"]}${opts.active ? " ui-button--active" : ""}${opts.class ? ` ${opts.class}` : ""}`;
    const common = `${attr("class", classes)} ${ctx.fns.procs.ui.attr({ action: opts.action, entity: opts.entity, id: opts.id, role: opts.uiRole, status: opts.status })}${attr("title", opts.title)}${attr("aria-label", opts.ariaLabel)}${opts.disabled ? " disabled aria-disabled=\"true\"" : ""}${htmx}${vals}${extra}`;

    if (opts.element === "summary") return `<summary${common}>${content}</summary>`;
    if (opts.href) return `<a href="${esc(opts.href)}"${common}>${content}</a>`;
    const type = opts.type ?? (opts.name ? "submit" : "button");
    return `<button type="${type}"${attr("name", opts.name)}${attr("value", opts.name ? opts.value ?? "1" : opts.value)}${common}>${content}</button>`;
}
