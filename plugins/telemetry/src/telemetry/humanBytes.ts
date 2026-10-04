// Byte sizes a person can read at a glance. Telemetry talks in gigabytes often
// enough that printing raw numbers makes the dashboard unreadable.
/**
 * Format a byte count as a short human-readable size.
 *
 * @param opts.bytes Number of bytes to format.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Number of bytes to format. */
    bytes: number;
}): string {
    const bytes = Number(opts.bytes) || 0;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
