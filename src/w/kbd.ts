/**
 * Draws a keyboard shortcut as key caps, e.g. ⌘B or Ctrl+Shift+P.
 * @param opts.keys The shortcut; "+" separates keys (⌘ ⌥ ⇧ ⌃ stay as one key each).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The shortcut; "+" separates keys (⌘ ⌥ ⇧ ⌃ stay as one key each). */
    keys: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const raw = String(opts.keys ?? "");
    const parts = raw.includes("+") ? raw.split("+") : (raw.match(/[⌘⌥⇧⌃]|[^⌘⌥⇧⌃]+/g) ?? []);
    return `<span class="w-kbd">${parts.filter(Boolean).map(k => `<kbd>${esc(k)}</kbd>`).join("")}</span>`;
}
