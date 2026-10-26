/**
 * Formats a running time for the jobs indicator: "8s", "4m 12s", "2h 5m".
 * @param opts.ms Duration in milliseconds.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Duration in milliseconds. */
    ms: number;
}): string {
    const s = Math.max(0, Math.floor(opts.ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}
