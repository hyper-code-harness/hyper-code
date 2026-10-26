/**
 * Flows blocks into as many newspaper columns as fit the width (each at least a name column wide); a block is
 * never split across two columns. Use it for many short groups side by side — sections of links in a wide
 * tile; a fixed two-pane layout is w.masterDetail or w.split.
 * @param opts.body Trusted HTML of the blocks (w.listSection).
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the blocks (w.listSection). */
    body: string;
}): string {
    return `<div class="w-columns">${opts.body}</div>`;
}
