// Behaviour hooks a page script or htmx extension reads: allowed on clickable widgets next to their Action.
// Visual attributes (class, style) are not hooks; anchor-name is the one style a popover opener needs.
const HOOK = /^(?:data-[a-z0-9_:-]+|aria-[a-z0-9_:-]+|hx-confirm|hx-disabled-elt|hx-popup|hx-popup-params|hx-indicator|onclick|id|form|popovertarget|popovertargetaction|role|tabindex|anchor-name)$/;

/**
 * Renders behaviour-hook attributes of a clickable widget (data-*, aria-*, hx-confirm, hx-disabled-elt, hx-popup,
 * onclick, id, form, popovertarget, role, tabindex; anchor-name becomes the style that anchors a popover) and
 * throws on anything else, so feature code cannot smuggle visual classes or styles through it. true writes a bare
 * attribute; false, null and undefined drop it.
 * @param opts.attrs Hook attributes by name.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Hook attributes by name. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    let out = "";
    for (const [name, value] of Object.entries(opts.attrs ?? {})) {
        if (!HOOK.test(name)) throw new Error(`w.hooks: ${name} is not a behaviour hook (data-*, aria-*, hx-confirm, onclick, id, form, popovertarget…)`);
        if (value === undefined || value === null || value === false) continue;
        if (name === "anchor-name") { out += ` style="anchor-name:${esc(value)}"`; continue; }
        out += value === true ? ` ${name}` : ` ${name}="${esc(value)}"`;
    }
    return out;
}
