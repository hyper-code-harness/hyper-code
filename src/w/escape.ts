// The one HTML escaper of the widget set: every page is a template literal, so this is the most-called function
// in the kit. Sync and allocation-free on the common path; null and undefined escape to "".
//
//   const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
//   `<td>${esc(patient.name)}</td>`
const REPLACEMENTS: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

/**
 * Escapes a value for HTML text or a quoted attribute (& < > " '); null and undefined become an empty string.
 * Use it for every untrusted value placed into a template-literal page.
 * @param opts.text Value to escape; non-strings are converted with String().
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Value to escape; non-strings are converted with String(). */
    text: unknown;
}): string {
    return String(opts.text ?? "").replace(/[&<>"']/g, ch => REPLACEMENTS[ch]!);
}
