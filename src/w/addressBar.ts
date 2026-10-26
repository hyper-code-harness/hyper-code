/**
 * Draws the address row of a view tab: back, forward, reload, the address and "open in a new tab". The address is
 * a form field named url, so Enter submits it; a page script takes the submit (hooks on the form and buttons).
 * @param opts.url The address shown.
 * @param opts.href Where "open in a new tab" goes when it differs from the shown address (the shown one is decoded).
 * @param opts.secure Lead icon: a lock for https, a globe for other sites; omit for a local address (no icon).
 * @param opts.back What back does; omit to disable.
 * @param opts.forward What forward does; omit to disable.
 * @param opts.reload What reload does.
 * @param opts.attrs Behaviour hooks (w.hooks) on the form: data-*, id — what a page script finds it by.
 * @param opts.backAttrs Behaviour hooks on the back button.
 * @param opts.forwardAttrs Behaviour hooks on the forward button.
 * @param opts.reloadAttrs Behaviour hooks on the reload button.
 * @param opts.mono Show the address in monospace (runtime addresses with JSON). @default false
 * @param opts.steps Show back and forward; off for a framed site whose history is not ours to drive. @default true
 * @param opts.start Trusted HTML before back/forward (a w.popover opener such as a tab picker).
 * @param opts.end Trusted HTML after the address, before "open in a new tab" (tools, a status).
 * @param opts.placeholder Hint in the empty address field.
 * @param opts.newTab Show "open in a new tab". @default true
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The address shown. */
    url: string;
    /** Where "open in a new tab" goes when it differs from the shown address (the shown one is decoded). */
    href?: string;
    /** Lead icon: a lock for https, a globe for other sites; omit for a local address (no icon). */
    secure?: boolean;
    /** What back does; omit to disable. */
    back?: types.w.Action;
    /** What forward does; omit to disable. */
    forward?: types.w.Action;
    /** What reload does. */
    reload?: types.w.Action;
    /** Behaviour hooks (w.hooks) on the form: data-*, id — what a page script finds it by. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
    /** Behaviour hooks on the back button. */
    backAttrs?: Record<string, string | number | boolean | null | undefined>;
    /** Behaviour hooks on the forward button. */
    forwardAttrs?: Record<string, string | number | boolean | null | undefined>;
    /** Behaviour hooks on the reload button. */
    reloadAttrs?: Record<string, string | number | boolean | null | undefined>;
    /** Show the address in monospace (runtime addresses with JSON). @default false */
    mono?: boolean;
    /** Show back and forward; off for a framed site whose history is not ours to drive. @default true */
    steps?: boolean;
    /** Trusted HTML before back/forward (a w.popover opener such as a tab picker). */
    start?: string;
    /** Trusted HTML after the address, before "open in a new tab" (tools, a status). */
    end?: string;
    /** Hint in the empty address field. */
    placeholder?: string;
    /** Show "open in a new tab". @default true */
    newTab?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    type Hooks = Record<string, string | number | boolean | null | undefined> | undefined;
    const btn = (icon: string, label: string, a: types.w.Action | undefined, attrs: Hooks) =>
        a ? ctx.fns.w.iconButton({ icon, label, action: a, size: 24, attrs }) : ctx.fns.w.iconButton({ icon, label, size: 24, disabled: true, attrs });
    const lead = opts.secure === undefined ? "" : ctx.fns.w.icon({ name: opts.secure ? "lock-simple" : "globe", size: 14 });
    const href = ctx.fns.w.safeUrl({ url: opts.href ?? opts.url });
    const open = href && opts.newTab !== false ? ctx.fns.w.iconButton({ icon: "arrow-square-out", label: "Open in a new tab", action: { href }, size: 24 }) : "";
    return `<form class="w-address"${ctx.fns.w.hooks({ attrs: opts.attrs })}>${opts.start ?? ""}${opts.steps === false ? "" : btn("arrow-left", "Back", opts.back, opts.backAttrs) + btn("arrow-right", "Forward", opts.forward, opts.forwardAttrs)}${btn("arrow-clockwise", "Reload", opts.reload ?? { action: "reload" }, opts.reloadAttrs)}${lead}<input class="w-address-input"${opts.mono ? " data-mono" : ""} name="url" value="${esc(opts.url)}" ${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""} spellcheck="false" autocomplete="off" aria-label="Address">${opts.end ?? ""}${open}</form>`;
}
