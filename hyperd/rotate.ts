// Size-bounded files for hyperd: a run's out.log and the event journal both grow forever otherwise
// (a chatty service, a crash loop, months of background jobs). One rule for both: when the file would pass
// its limit it becomes `<file>.1` (replacing the previous one) and a fresh file starts — so at most twice the
// limit is ever on disk, and the newest output is always in the file itself.
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";

export const LOG_MAX_BYTES = Number(process.env.HYPERD_LOG_MAX_BYTES ?? 10 * 1024 * 1024);
export const EVENTS_MAX_BYTES = Number(process.env.HYPERD_EVENTS_MAX_BYTES ?? 5 * 1024 * 1024);
/** Run directories (run-<n>) kept per unit; older ones are removed when a new run starts. */
export const KEEP_RUNS = Math.max(1, Number(process.env.HYPERD_KEEP_RUNS ?? 5));

const sizeOf = (path: string) => { try { return statSync(path).size; } catch { return 0; } };

/** An appender that rotates `path` to `path.1` once it would grow past `max` bytes. */
export function rotatingAppender(path: string, max = LOG_MAX_BYTES) {
    let size = sizeOf(path);
    return (data: Uint8Array | string) => {
        const n = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
        if (size > 0 && size + n > max) {
            try { renameSync(path, path + ".1"); size = 0; } catch { /* keep appending rather than lose output */ }
        }
        appendFileSync(path, data);
        size += n;
    };
}

/** The event journal: ndjson lines with an increasing `seq`, rotated like a log. */
export function journal(path: string, max = EVENTS_MAX_BYTES) {
    const append = rotatingAppender(path, max);
    const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    const parse = (line: string) => { try { return JSON.parse(line); } catch { return null; } };
    return {
        append: (event: Record<string, unknown>) => append(JSON.stringify(event) + "\n"),
        /** The last seq written, from the current file or (right after a rotation) the previous one. */
        lastSeq(): number {
            for (const file of [path, path + ".1"]) {
                const all = lines(file);
                for (let i = all.length - 1; i >= 0; i--) { const e = parse(all[i]!); if (e?.seq) return e.seq; }
            }
            return 0;
        },
        /** Events after `after`, oldest first, across the rotated file and the current one. */
        read(after: number, limit: number): any[] {
            const out: any[] = [];
            const current = lines(path);
            const first = parse(current[0] ?? "")?.seq ?? Infinity;
            // the previous file is read only when the caller is behind the start of the current one
            const all = after + 1 < first ? [...lines(path + ".1"), ...current] : current;
            for (const line of all) {
                const e = parse(line);
                if (e && e.seq > after) { out.push(e); if (out.length >= limit) break; }
            }
            return out;
        },
    };
}
