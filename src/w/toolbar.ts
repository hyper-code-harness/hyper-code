/**
 * Draws a row of controls with a left group and a right group.
 * @param opts.start Trusted HTML on the left.
 * @param opts.end Trusted HTML on the right.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML on the left. */
    start?: string;
    /** Trusted HTML on the right. */
    end?: string;
}): string {
    return `<div class="w-toolbar"><div class="w-toolbar-start">${opts.start ?? ""}</div><div class="w-toolbar-end">${opts.end ?? ""}</div></div>`;
}
