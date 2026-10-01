// The ring around a running tool call's icon: one arc that answers two
// questions at once.
//
// "Is it alive?" is answered by motion — the arc sweeps around the circle,
// because a frozen pixel and a hung process look identical, and motion is the
// only thing a stuck process cannot fake.
//
// "How much longer should I wait?" is answered by that same arc's length: it
// starts as a short dash and grows toward a closed ring as the call approaches
// its declared timeout. One shape carries both, so the two readings can never
// contradict each other and there is only one thing on screen to learn — a
// separate progress track plus a separate spinner said the same thing twice.
//
// Without a declared timeout there is nothing to measure against, so the arc
// keeps a constant length and only turns: honest about being liveness alone.
//
// The length is computed server-side at render time and refined client-side
// every second (ui/tool-timer.js). Re-rendering it per second from the server
// would cost one request per second per open tab to say what the browser can
// compute from two numbers; rendering it empty and letting the client fill it
// would make it snap back to nothing on every poll of the live region.
/**
 * Renders the turning progress arc drawn around a running tool call's icon.
 *
 * Use wherever a live tool call needs its chip — the inline chat indicator and its details popup share this markup so both show the same ring; the arc tracks elapsed time against the declared timeout and a travelling dot shows the call is still moving.
 * @param opts.icon Phosphor icon name shown inside the ring.
 * @param opts.startedAt Epoch milliseconds when the call started.
 * @param opts.timeoutMs Declared timeout in milliseconds; without it the ring shows liveness only, since there is no limit to show progress against.
 * @param opts.iconClass Extra classes for the icon element.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Phosphor icon name shown inside the ring. */
        icon: string;
        /** Epoch milliseconds when the call started. */
        startedAt: number;
        /** Declared timeout in milliseconds; without it the ring shows liveness only, since there is no limit to show progress against. */
        timeoutMs?: number;
        /** Extra classes for the icon element. */
        iconClass?: string;
    },
): string {
    const esc = (value: any) => ctx.fns.procs.ui.escape({ text: value });
    const started = Number(opts.startedAt) || Date.now();
    const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0;
    const deadline = timeout ? started + timeout : 0;

    // viewBox units, not pixels: the same ring scales from the 21px chat chip
    // to the 24px one in the popup without a second set of numbers.
    const C = 97.4; // circumference at r=15.5

    // Full faint circle so the arc is read as "part of a whole" — an arc alone
    // on empty space reads as decoration, not as a measure.
    const track = `<circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="3"></circle>`;

    // One arc, turning, whose length is the progress.
    //
    // Rendered at its true length, not at zero: the live region replaces this
    // markup every few seconds, so an arc that always arrived empty would snap
    // back to nothing on every poll and then creep forward again — a progress
    // bar that keeps resetting is worse than none, because it reads as the work
    // restarting. The ticker refines it each second; the server states where it
    // already is.
    //
    // A floor under the length keeps it visible in the first seconds, when the
    // true value rounds to a dot: this shape's first job is to say "running".
    const MIN_ARC = 9;
    const done = deadline ? Math.min(1, Math.max(0, (Date.now() - started) / (deadline - started))) : 0;
    const length = deadline ? Math.max(MIN_ARC, C * done) : 26;

    const arc = `<circle class="tool-progress animate-spin [transform-origin:50%_50%]" cx="18" cy="18" r="15.5" fill="none"`
        + ` stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="${length.toFixed(1)} ${C}"`
        // The live region replaces this element every few seconds and a fresh
        // element restarts its animation at frame zero, which reads as a jerk
        // backwards. ui/spin-sync.js phases it to the wall clock so the new arc
        // picks up exactly where the old one was.
        + ` data-spin-sync`
        + (deadline ? ` data-tool-started-at="${started}" data-tool-deadline="${deadline}"` : "")
        + `></circle>`;

    return `<span class="pointer-events-none absolute -inset-0.5">`
        + `<svg class="h-full w-full" viewBox="0 0 36 36" fill="none" aria-hidden="true">${track}${arc}</svg>`
        + `</span>`
        + `<i class="ph ph-${esc(opts.icon)}${opts.iconClass ? " " + esc(opts.iconClass) : ""}" aria-hidden="true"></i>`;
}
