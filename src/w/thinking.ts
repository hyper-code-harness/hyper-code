/**
 * Draws the model's reasoning folded to one quiet line ("Thought for 12s ›") that opens to the text.
 * @param opts.text The reasoning text.
 * @param opts.seconds How long it thought.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The reasoning text. */
    text: string;
    /** How long it thought. */
    seconds?: number;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    return `<details class="w-thinking"><summary>${ctx.fns.w.icon({ name: "brain", size: 12 })}<span>${opts.seconds ? `Thought for ${Math.round(opts.seconds)}s` : "Thinking"}</span></summary><div class="w-thinking-text">${esc(opts.text)}</div></details>`;
}
