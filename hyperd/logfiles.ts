// Daily log files for hyperd — the logrotate idea, done lazily. The writer of a file (the holder for a run's
// out.log, hyperd for events.ndjson) notices on its first write of a new day that the day has changed, moves
// the file aside as <base>.<YYYY-MM-DD><ext> and starts a fresh one. Later, tidy() gzips day files that have
// settled (<base>.<day><ext>.gz) and removes the ones older than the retention. Nothing runs at midnight and
// nothing is cut in the middle of a write: there is one writer per file and it rolls its own file.
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Days of day files kept (by the day in their name). @default 14 */
export const KEEP_DAYS = Math.max(1, Number(process.env.HYPERD_LOG_KEEP_DAYS ?? 14));
const DAY_MS = 24 * 3600_000;

/** Local calendar day of a timestamp, YYYY-MM-DD. */
export const dayOf = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nextMidnight = (ms: number) => { const d = new Date(ms); d.setHours(24, 0, 0, 0); return d.getTime(); };

// "out.log" → ["out", ".log"], "events.ndjson" → ["events", ".ndjson"]
const split = (file: string) => { const i = file.lastIndexOf("."); return i > 0 ? [file.slice(0, i), file.slice(i)] : [file, ""]; };
/** Name of the day file of `file`: out.log + 2026-10-28 → out.2026-10-28.log. */
export const dayName = (file: string, day: string) => { const [b, e] = split(file); return `${b}.${day}${e}`; };
// out.2026-10-28.log, out.2026-10-28-1.log, out.2026-10-28.log.gz
const DAY_FILE = /^(.+)\.(\d{4}-\d{2}-\d{2})(?:-(\d+))?(\.[^.]+)?(\.gz)?$/;

/** Moves `path` aside as its day file when its last write was on an earlier day than `now`. Returns the day file, or null. */
export function rollIfNewDay(path: string, now = Date.now()): string | null {
    let st;
    try { st = statSync(path); } catch { return null; }
    const day = dayOf(st.mtimeMs);
    if (st.size === 0 || day >= dayOf(now)) return null;
    let target = join(dirname(path), dayName(basename(path), day));
    // the same day was rolled already (several runs that day): number the next one
    for (let n = 1; existsSync(target) || existsSync(target + ".gz"); n++) target = join(dirname(path), dayName(basename(path), `${day}-${n}`));
    renameSync(path, target);
    return target;
}

/** An append function for `path` that rolls the file to its day file on the first write of a new day. */
export function dailyAppender(path: string, clock: () => number = Date.now) {
    rollIfNewDay(path, clock()); // a file left over from an earlier day
    let boundary = nextMidnight(clock());
    return (data: Uint8Array | string) => {
        const now = clock();
        if (now >= boundary) { rollIfNewDay(path, now); boundary = nextMidnight(now); }
        appendFileSync(path, data);
    };
}

/** Day files of `file` in `dir`, oldest first: { name, day, gz }. */
export function dayFiles(dir: string, file: string): Array<{ name: string; day: string; gz: boolean }> {
    const [b, e] = split(file);
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return []; }
    return names.map((name) => ({ name, m: DAY_FILE.exec(name) }))
        .filter(({ m }) => m && m[1] === b && (m[4] ?? "") === e)
        .map(({ name, m }) => ({ name, day: m![2]!, n: Number(m![3] ?? 0), gz: !!m![5] }))
        .sort((x, y) => x.day.localeCompare(y.day) || x.n - y.n)
        .map(({ name, day, gz }) => ({ name, day, gz }));
}

/** Text of a day file, gzipped or not. */
export function readDayFile(path: string): Buffer {
    const raw = readFileSync(path);
    return path.endsWith(".gz") ? Buffer.from(Bun.gunzipSync(raw)) : raw;
}

async function gzip(path: string) {
    try {
        const p = Bun.spawn(["gzip", "-f", "-n", path], { stdout: "ignore", stderr: "ignore" });
        if ((await p.exited) === 0) return;
    } catch { /* no gzip binary: compress in process */ }
    if (!existsSync(path)) return;
    writeFileSync(path + ".gz", Bun.gzipSync(readFileSync(path)));
    rmSync(path, { force: true });
}

/**
 * Gzips the day files in `dir` that were set aside at least `settleMs` ago (a reader may still be finishing the
 * tail of a just-rolled file) and removes day files whose day is older than `keepDays`. Current files are not touched.
 */
export async function tidy(dir: string, opts: { now?: number; keepDays?: number; settleMs?: number } = {}): Promise<{ gzipped: string[]; removed: string[] }> {
    const now = opts.now ?? Date.now();
    const oldest = dayOf(now - (opts.keepDays ?? KEEP_DAYS) * DAY_MS);
    const out = { gzipped: [] as string[], removed: [] as string[] };
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return out; }
    for (const name of names) {
        const m = DAY_FILE.exec(name);
        if (!m) continue;
        const path = join(dir, name);
        if (m[2]! < oldest) { rmSync(path, { force: true }); out.removed.push(name); continue; }
        if (m[5]) continue;
        // ctime changes on rename, so it says when the file was set aside
        let changed = now;
        try { changed = statSync(path).ctimeMs; } catch { continue; }
        const settle = opts.settleMs ?? 60_000;
        if (settle > 0 && now - changed < settle) continue;
        await gzip(path);
        out.gzipped.push(name);
    }
    return out;
}

/** An ndjson journal with an increasing `seq`, rolled by day; reads reach into the newest day file when needed. */
export function journal(path: string, clock: () => number = Date.now) {
    const append = dailyAppender(path, clock);
    const parse = (line: string) => { try { return JSON.parse(line); } catch { return null; } };
    const linesOf = (text: string) => text.split("\n").filter(Boolean);
    const current = () => existsSync(path) ? linesOf(readFileSync(path, "utf8")) : [];
    const previous = () => {
        const last = dayFiles(dirname(path), basename(path)).at(-1);
        return last ? linesOf(readDayFile(join(dirname(path), last.name)).toString("utf8")) : [];
    };
    return {
        append: (event: Record<string, unknown>) => append(JSON.stringify(event) + "\n"),
        /** The last seq written: from the current file or, right after a roll, from the newest day file. */
        lastSeq(): number {
            for (const lines of [current(), previous()]) {
                for (let i = lines.length - 1; i >= 0; i--) { const e = parse(lines[i]!); if (e?.seq) return e.seq; }
            }
            return 0;
        },
        /** Events after `after`, oldest first; the newest day file is read only when `after` is before the current file. */
        read(after: number, limit: number): any[] {
            const now = current();
            const first = parse(now[0] ?? "")?.seq ?? Infinity;
            const all = after + 1 < first ? [...previous(), ...now] : now;
            const out: any[] = [];
            for (const line of all) { const e = parse(line); if (e && e.seq > after) { out.push(e); if (out.length >= limit) break; } }
            return out;
        },
    };
}
