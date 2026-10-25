/**
 * Render a top-layer popup anchored directly below its trigger
 *
 * Creates a native Popover API panel in the browser top layer while anchoring it to the originating toolbar button. Use for small contextual forms that must remain below their trigger without being covered by chat messages or clipped by scrolling containers.
 * @param opts.id Unique DOM identifier for the popup panel.
 * @param opts.triggerHtml Trusted rendered HTML placed inside the trigger button.
 * @param opts.contentHtml Trusted rendered HTML placed inside the anchored popup panel.
 * @param opts.triggerAttrs Additional trusted HTML attributes for the trigger button.
 * @param opts.panelAttrs Additional trusted HTML attributes for the popup panel.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique DOM identifier for the popup panel. */
        id: string;
        /** Trusted rendered HTML placed inside the trigger button. */
        triggerHtml: string;
        /** Trusted rendered HTML placed inside the anchored popup panel. */
        contentHtml: string;
        /** Additional trusted HTML attributes for the trigger button. */
        triggerAttrs?: string;
        /** Additional trusted HTML attributes for the popup panel. */
        panelAttrs?: string;
    },
): Promise<string> {
    const rawId = String(opts.id ?? "").trim();
    if (!rawId) throw new Error("inplacePopup: id is required");
    const safeBase = rawId.replace(/[^a-zA-Z0-9_-]/g, "-");
    // Keep already-safe IDs readable. Unsafe IDs receive a deterministic suffix
    // so values such as "a/b" and "a-b" cannot collapse to the same DOM ID.
    let hash = 2166136261;
    for (let i = 0; i < rawId.length; i++) hash = Math.imul(hash ^ rawId.charCodeAt(i), 16777619);
    const id = safeBase === rawId ? safeBase : `${safeBase}-${(hash >>> 0).toString(36)}`;
    const esc = (value: string) => ctx.fns.w.escape({ text: value });
    const anchor = "--inplace-" + id;
    const triggerAttrs = String(opts.triggerAttrs ?? "").trim();
    const panelAttrs = String(opts.panelAttrs ?? "").trim();
    const attrs: Record<string, string | boolean> = { popovertarget: id, 'aria-haspopup': 'dialog', 'anchor-name': anchor };
    for (const match of triggerAttrs.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
        const name = match[1];
        if (name) attrs[name] = match[2] ?? true;
    }
    // `class`, `title` and `aria-label` are first-class button options, not raw attrs.
    const className = typeof attrs.class === 'string' ? attrs.class : undefined;
    const title = typeof attrs.title === 'string' ? attrs.title : undefined;
    const ariaLabel = typeof attrs['aria-label'] === 'string' ? attrs['aria-label'] : undefined;
    delete attrs.class;
    delete attrs.title;
    delete attrs['aria-label'];
    return ctx.fns.w.pressable({ html: opts.triggerHtml, marks: { action: 'open-inplace-popup' }, class: className, title, label: ariaLabel, attrs })
      + '<div id="' + esc(id) + '" popover style="position-anchor:' + anchor + '" class="inplace-popup-panel"' + (panelAttrs ? ' ' + panelAttrs : '') + '>' + opts.contentHtml + '</div>';
}
