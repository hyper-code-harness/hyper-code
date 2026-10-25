// A round mark for a person — their initials on a soft accent, or a photo when
// there is one. The same one the patient scope bar wears, made a component.
/**
 * Perform avatar for the ui subsystem.
 * @param opts.name The target name.
 * @param opts.src The src value used by the operation.
 * @param opts.size The size value used by the operation.
 * @deprecated use w.avatar
 */
export default function (ctx: Context, _session: Session | null, opts: {name?: string; src?: string; size?: "sm" | "md" | "lg" }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    // the shared component layer styles `.avatar > div`, and it sizes nothing itself: a child that
    // is a `span` gets no centring, and a width with no height is a pill with the
    // initials hanging out of it. So: a div inside a div, and both dimensions.
    const px = opts.size === "lg" ? "h-10 w-10 text-sm" : opts.size === "sm" ? "h-6 w-6 text-xs" : "h-8 w-8 text-xs";
    if (opts.src) return `<div class="avatar"><div class="${px} rounded-full"><img src="${esc(opts.src)}" alt="${esc(opts.name ?? "")}"></div></div>`;
    return `<div class="avatar avatar-placeholder"><div class="bg-primary/10 text-primary ${px} rounded-full font-semibold" aria-hidden="true">${esc(initials(opts.name ?? "?"))}</div></div>`;
}

function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
}
