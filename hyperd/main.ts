// hyperd: a small user-level process supervisor (between tmux, a boot loader and systemd).
// Reads declarative units, starts each run under its own detached holder, restarts per policy, checks
// readiness, writes an event journal with seq, and answers a JSON API on a unix socket.
// State lives in files only (hyperd may be what starts the database).
//
//   bun hyperd/main.ts            HYPERD_HOME (default ~/.hyper/run/hyperd), HYPERD_UNITS (default ~/.hyper/units, ':'-separated)
import { appendFileSync, chmodSync, closeSync, existsSync, openSync, readSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkUnit, loadUnitFile, UNIT_FILE, type Unit } from "./Unit.ts";
import { dayFiles, journal, readDayFile, rollIfNewDay, tidy } from "./logfiles.ts";

const HOME = resolve(process.env.HYPERD_HOME ?? join(homedir(), ".hyper/run/hyperd"));
const UNIT_DIRS = (process.env.HYPERD_UNITS ?? join(homedir(), ".hyper/units")).split(":").filter(Boolean);
const HOLDER = join(import.meta.dir, "holder.ts");
const TICK_MS = Number(process.env.HYPERD_TICK_MS ?? 200);
mkdirSync(join(HOME, "units"), { recursive: true, mode: 0o700 });
chmodSync(HOME, 0o700);

type State = "stopped" | "waiting" | "starting" | "running" | "ready" | "stopping" | "backoff" | "exited" | "failed";
type Exit = { code: number | null; signal: string | null; at: number; reason: string };
type Sup = {
    unit: Unit;
    source: "file" | "transient";
    file?: string;
    state: State;
    run: number;
    want: boolean;           // should be running
    restarts: number;        // in a row
    startedAt?: number;
    readyAt?: number;
    nextAt?: number;         // backoff / next ready probe
    stopReason?: string;
    stopDeadline?: number;
    lastExit?: Exit;
    logOff: number;
    logIno?: number;         // inode of the out.log logOff counts in; a new one means the holder rolled the day
    carry: string;
    probing?: boolean;
    error?: string;
    env?: Record<string, string>; // one-shot env from the API (secrets): memory only, never on disk
};
const units = new Map<string, Sup>();

// ---- events -------------------------------------------------------------------------------------
// events.ndjson is daily like out.log: rolled to events.<day>.ndjson on the first event of a new day
const EVENTS = journal(join(HOME, "events.ndjson"));
let seq = EVENTS.lastSeq();
const waiters = new Set<() => void>();
function emit(unit: string, type: string, data: Record<string, unknown> = {}) {
    const s = units.get(unit);
    const ev = { seq: ++seq, at: Date.now(), unit, run: s?.run ?? 0, type, owner: s?.unit.owner, ...data };
    EVENTS.append(ev);
    for (const w of waiters) w();
    waiters.clear();
    return ev;
}
const readEvents = (after: number, limit: number) => EVENTS.read(after, limit);

// ---- files ------------------------------------------------------------------------------------------
const unitDir = (name: string) => join(HOME, "units", name);
const runDir = (name: string, run: number) => join(unitDir(name), `run-${run}`);
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
// EPERM means the pid belongs to someone else (reused after a reboot): not ours, so not alive
const alive = (pid: number | null | undefined) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const commandOf = (pid: number) => { try { return Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString().trim(); } catch { return ""; } };
// a pid read from disk may have been reused after a reboot: check it is really our process
const isOurs = (pid: number | null | undefined, ...marks: string[]) => alive(pid) && marks.every((m) => commandOf(pid!).includes(m));
const writeAtomic = (p: string, data: string, mode?: number) => { writeFileSync(p + ".tmp", data, mode ? { mode } : undefined); renameSync(p + ".tmp", p); };
const pidOf = (name: string, run: number, file: string) => Number(readFileSync(join(runDir(name, run), file), "utf8")) || null;
function persist(s: Sup) {
    writeAtomic(join(unitDir(s.unit.name), "state.json"), JSON.stringify({ run: s.run, want: s.want, restarts: s.restarts, state: s.state, startedAt: s.startedAt, readyAt: s.readyAt, lastExit: s.lastExit, logOff: s.logOff, logIno: s.logIno, source: s.source, file: s.file }));
}
function setState(s: Sup, state: State, data: Record<string, unknown> = {}, event?: string) {
    s.state = state;
    persist(s);
    if (event) emit(s.unit.name, event, data);
}

// ---- lifecycle --------------------------------------------------------------------------------------
const kindOf = (u: Unit) => u.kind ?? "service";
const policyOf = (u: Unit) => u.restart?.policy ?? (kindOf(u) === "service" ? "on-failure" : "no");
// a terminal session is hung up like a closed terminal window; interactive shells ignore SIGTERM
const usesPty = (u: Unit) => u.pty === undefined ? kindOf(u) === "session" : !!u.pty;
const stopSignal = (u: Unit) => u.stop?.signal ?? (usesPty(u) ? "SIGHUP" : "SIGTERM");
const argv = (u: Unit) => Array.isArray(u.cmd) ? u.cmd : ["bash", "-lc", u.cmd];
const expand = (p: string) => p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

function register(unit: Unit, source: "file" | "transient", file?: string, env?: Record<string, string>) {
    mkdirSync(unitDir(unit.name), { recursive: true, mode: 0o700 });
    writeAtomic(join(unitDir(unit.name), "spec.json"), JSON.stringify({ unit, source, file }, null, 2));
    const prev = units.get(unit.name);
    if (prev) { prev.unit = unit; prev.source = source; prev.file = file; if (env || source === "transient") prev.env = env; persist(prev); return prev; }
    const s: Sup = { unit, source, file, state: "stopped", run: 0, want: false, restarts: 0, logOff: 0, carry: "", env };
    units.set(unit.name, s);
    persist(s);
    return s;
}

function launch(s: Sup) {
    const u = s.unit;
    s.run += 1;
    const dir = runDir(u.name, s.run);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const pty = u.pty === undefined ? kindOf(u) === "session" : u.pty;
    writeFileSync(join(dir, "launch.json"), JSON.stringify({
        cmd: argv(u), cwd: u.cwd ? expand(u.cwd) : undefined,
        pty: pty ? { cols: (typeof pty === "object" && pty.cols) || 120, rows: (typeof pty === "object" && pty.rows) || 40 } : false,
        // a task gets no stdin (EOF at once, like a backgrounded shell job); services and sessions keep it for input
        stdin: !pty && kindOf(u) === "task" ? "ignore" : "pipe",
    }));
    // env: unit env plus the one-shot API env (secrets, memory only); the holder deletes env.json right after reading
    writeAtomic(join(dir, "env.json"), JSON.stringify({ ...(u.env ?? {}), ...(s.env ?? {}) }), 0o600);
    const h = Bun.spawn(["bun", HOLDER, dir], { cwd: dir, detached: true, stdio: ["ignore", "ignore", "ignore"] } as any);
    h.unref();
    writeFileSync(join(dir, "holder.pid"), String(h.pid)); // known at once, no window where the run has no holder pid
    s.startedAt = Date.now(); s.readyAt = undefined; s.logOff = 0; s.logIno = undefined; s.carry = ""; s.stopReason = undefined; s.stopDeadline = undefined; s.error = undefined;
    s.nextAt = Date.now() + (u.ready?.intervalMs ?? 500);
    setState(s, u.ready ? "starting" : "running", { holderPid: h.pid, runDir: dir }, "started");
    if (!u.ready) markReady(s);
}

function markReady(s: Sup) {
    s.readyAt = Date.now();
    setState(s, "ready", { afterMs: s.readyAt - (s.startedAt ?? s.readyAt) }, "ready");
}

function start(s: Sup) {
    s.want = true;
    if (["starting", "running", "ready", "stopping"].includes(s.state)) { persist(s); return; }
    s.restarts = 0;
    const missing = (s.unit.after ?? []).filter((d) => units.get(d)?.state !== "ready");
    if (missing.length) { setState(s, "waiting", { for: missing }, s.state === "waiting" ? undefined : "waiting"); return; }
    launch(s);
}

function signalRun(s: Sup, sig: string) {
    const child = (() => { try { return pidOf(s.unit.name, s.run, "child.pid"); } catch { return null; } })();
    if (!child) return false;
    try { process.kill(-child, sig as any); return true; } catch {}
    try { process.kill(child, sig as any); return true; } catch { return false; }
}

function stop(s: Sup, reason = "stopped") {
    s.want = false;
    if (s.state === "waiting" || s.state === "backoff") { setState(s, "stopped", { reason }, "stopped"); return; }
    if (!["starting", "running", "ready"].includes(s.state)) { persist(s); return; }
    s.stopReason = reason;
    s.stopDeadline = Date.now() + (s.unit.stop?.timeoutMs ?? 10_000);
    signalRun(s, stopSignal(s.unit));
    setState(s, "stopping", { reason, signal: stopSignal(s.unit) }, "stopping");
}

function onExit(s: Sup, exit: Exit) {
    s.lastExit = exit;
    // a run that stayed up for a while (or passed a real ready check) resets the crash-loop counter
    if (exit.at - (s.startedAt ?? exit.at) >= 10_000 || (s.unit.ready && s.readyAt)) s.restarts = 0;
    const failed = exit.reason === "lost" || exit.signal != null || exit.code !== 0;
    emit(s.unit.name, "exited", { code: exit.code, signal: exit.signal, reason: exit.reason, ms: exit.at - (s.startedAt ?? exit.at) });
    const policy = policyOf(s.unit);
    const again = s.want && !s.stopReason && (policy === "always" || (policy === "on-failure" && failed));
    if (!again) { s.want = false; setState(s, failed && !s.stopReason ? "failed" : "exited"); return; }
    const max = s.unit.restart?.maxRestarts ?? 0;
    if (max && s.restarts >= max) { s.want = false; setState(s, "failed", { restarts: s.restarts }, "gave_up"); return; }
    const [first, cap] = s.unit.restart?.backoffMs ?? [1000, 30_000];
    const inMs = Math.min(cap, first * 2 ** Math.min(10, s.restarts));
    s.restarts += 1;
    s.nextAt = Date.now() + inMs;
    setState(s, "backoff", { inMs, attempt: s.restarts }, "restarting");
}

// ---- tick -------------------------------------------------------------------------------------------
const toRe = (p: string) => { const m = /^\/(.*)\/([a-z]*)$/.exec(p); return m ? new RegExp(m[1], m[2]) : null; };
const matches = (p: string, text: string) => { const re = toRe(p); return re ? re.test(text) : text.includes(p); };

function readFrom(path: string, off: number, max: number): Buffer {
    let size = 0;
    try { size = statSync(path).size; } catch { return Buffer.alloc(0); }
    if (size <= off) return Buffer.alloc(0);
    const len = Math.min(size - off, max);
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, off);
    closeSync(fd);
    return buf;
}

function readNewOutput(s: Sup): string {
    const dir = runDir(s.unit.name, s.run);
    const log = join(dir, "out.log");
    let size = 0, ino = 0;
    try { const st = statSync(log); size = st.size; ino = st.ino; } catch { /* rolled, the new file not written yet */ }
    if (s.logIno && ino !== s.logIno) {
        // the holder rolled out.log to its day file: finish that file's tail first, so no ready/logMatch line is lost
        const rolled = dayFiles(dir, "out.log").filter((f) => !f.gz).at(-1);
        const tail = rolled ? readFrom(join(dir, rolled.name), s.logOff, 1 << 20) : Buffer.alloc(0);
        s.logOff = 0; s.logIno = ino || undefined;
        return tail.toString("utf8") + (ino ? readNewOutput(s) : "");
    }
    if (ino) s.logIno = ino;
    if (size <= s.logOff) return "";
    const len = Math.min(size - s.logOff, 1 << 20);
    const fd = openSync(log, "r");
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, s.logOff);
    closeSync(fd);
    s.logOff += len;
    return buf.toString("utf8");
}

async function probe(s: Sup, text: string): Promise<boolean> {
    const r = s.unit.ready!;
    if (r.log !== undefined) return matches(r.log, text);
    if (r.http) { try { const res = await fetch(r.http, { signal: AbortSignal.timeout(2000) }); return res.ok; } catch { return false; } }
    if (r.tcp !== undefined) {
        const [host, port] = String(r.tcp).includes(":") ? String(r.tcp).split(":") : ["127.0.0.1", String(r.tcp)];
        try {
            const sock = await Promise.race([Bun.connect({ hostname: host, port: Number(port), socket: { data() {} } }), Bun.sleep(2000).then(() => { throw new Error("timeout"); })]);
            sock.end(); return true;
        } catch { return false; }
    }
    if (r.exec) {
        try {
            const p = Bun.spawn(r.exec, { stdio: ["ignore", "ignore", "ignore"], cwd: s.unit.cwd ? expand(s.unit.cwd) : undefined, env: { ...process.env, ...(s.unit.env ?? {}) } });
            const t = setTimeout(() => p.kill("SIGKILL"), 5000);
            try { return (await p.exited) === 0; } finally { clearTimeout(t); }
        } catch { return false; }
    }
    return true;
}

const GC_MS = Number(process.env.HYPERD_GC_MS ?? 24 * 3600_000);
// gzip day files that have settled and drop old ones, at most every TIDY_MS (lazy, from tick)
const TIDY_MS = Number(process.env.HYPERD_TIDY_MS ?? 3600_000);
let tidiedAt = 0, tidying = false;
function tidyLogs(now: number) {
    if (tidying || now - tidiedAt < TIDY_MS) return;
    tidying = true; tidiedAt = now;
    (async () => {
        await tidy(HOME, { now });
        for (const name of readdirSync(join(HOME, "units"))) {
            let runs: string[] = [];
            try { runs = readdirSync(unitDir(name)).filter((e) => /^run-\d+$/.test(e)); } catch { continue; }
            const s = units.get(name);
            for (const r of runs) {
                const dir = join(unitDir(name), r);
                const live = !!s && Number(r.slice(4)) === s.run && ["starting", "running", "ready", "stopping"].includes(s.state);
                // nobody writes the out.log of a finished run, so nobody would roll it: roll it here
                if (!live) rollIfNewDay(join(dir, "out.log"), now);
                await tidy(dir, { now });
                // a finished run whose logs have all expired goes away with its directory
                if (!live && Number(r.slice(4)) !== s?.run && !existsSync(join(dir, "out.log")) && !dayFiles(dir, "out.log").length) rmSync(dir, { recursive: true, force: true });
            }
        }
    })().catch((error) => console.error("hyperd tidy", error)).finally(() => { tidying = false; });
}

async function tick() {
    const now = Date.now();
    tidyLogs(now);
    for (const s of units.values()) {
        const name = s.unit.name;
        try {
            // finished transient units (background jobs) are removed with their logs a day after they ended
            if (s.source === "transient" && !s.want && ["exited", "failed", "stopped"].includes(s.state) && s.lastExit && now - s.lastExit.at > GC_MS) {
                emit(name, "removed", { reason: "gc" });
                units.delete(name);
                rmSync(unitDir(name), { recursive: true, force: true });
                continue;
            }
            if (s.state === "waiting" && s.want) {
                if ((s.unit.after ?? []).every((d) => units.get(d)?.state === "ready")) launch(s);
                continue;
            }
            if (s.state === "backoff" && s.want && now >= (s.nextAt ?? 0)) { launch(s); continue; }
            if (!["starting", "running", "ready", "stopping"].includes(s.state)) continue;

            // output: log_match events and ready.log
            const fresh = readNewOutput(s);
            if (fresh) {
                const text = s.carry + fresh;
                const lines = text.split(/\r?\n/);
                s.carry = lines.pop()!.slice(-4096);
                let n = 0;
                for (const line of lines) for (const p of s.unit.logMatch ?? []) if (n < 20 && matches(p, line)) { n++; emit(name, "log_match", { pattern: p, line: line.slice(0, 500) }); }
                if (s.state === "starting" && s.unit.ready?.log !== undefined && matches(s.unit.ready.log, text)) markReady(s);
            }

            // exit
            const dir = runDir(name, s.run);
            const ex = readJson(join(dir, "exit.json"));
            if (ex) {
                // drain the tail for log_match before reporting the exit
                const rest = readNewOutput(s);
                if (rest) for (const line of (s.carry + rest).split(/\r?\n/)) for (const p of s.unit.logMatch ?? []) if (line && matches(p, line)) emit(name, "log_match", { pattern: p, line: line.slice(0, 500) });
                onExit(s, { code: ex.code, signal: ex.signal, at: ex.at, reason: s.stopReason ?? (ex.error ? "start" : "exit") });
                continue;
            }
            const holder = (() => { try { return pidOf(name, s.run, "holder.pid"); } catch { return null; } })();
            if (!alive(holder) && !existsSync(join(dir, "exit.json"))) {
                // the holder died (SIGKILL, OOM) but its child may still run in its own group: kill it before any
                // restart, or a second copy of the service would start next to it
                signalRun(s, "SIGKILL");
                rmSync(join(dir, "env.json"), { force: true }); // the holder may have died before reading it
                onExit(s, { code: null, signal: null, at: now, reason: "lost" });
                continue;
            }

            // SIGKILL after the deadline, repeated until exit.json shows up (the child pid may appear late)
            if (s.state === "stopping" && now >= (s.stopDeadline ?? Infinity)) { signalRun(s, "SIGKILL"); s.stopDeadline = now + 1000; }
            if (s.unit.ttlMs && (s.state === "running" || s.state === "ready" || s.state === "starting") && now - (s.startedAt ?? now) >= s.unit.ttlMs) stop(s, "ttl");

            if (s.state === "starting" && s.unit.ready && s.unit.ready.log === undefined && !s.probing && now >= (s.nextAt ?? 0)) {
                s.probing = true;
                s.nextAt = now + (s.unit.ready.intervalMs ?? 500);
                const run = s.run;
                const limit = Math.max(1000, s.unit.ready.intervalMs ?? 500) + 4000;
                Promise.race([probe(s, ""), Bun.sleep(limit).then(() => false)])
                    .then((ok) => { if (ok && s.state === "starting" && s.run === run) markReady(s); }).finally(() => { s.probing = false; });
            }
            if (s.state === "starting" && s.unit.ready && now - (s.startedAt ?? now) > (s.unit.ready.timeoutMs ?? 60_000) && !s.error) {
                s.error = "ready timeout";
                emit(name, "unhealthy", { reason: "ready timeout" });
            }
        } catch (error: any) {
            if (s.error !== String(error?.message ?? error)) { s.error = String(error?.message ?? error); emit(name, "error", { error: s.error }); }
        }
    }
}

// ---- recovery and unit files ------------------------------------------------------------------------
function recover() {
    for (const name of readdirSync(join(HOME, "units"))) {
        const spec = readJson(join(unitDir(name), "spec.json"));
        const st = readJson(join(unitDir(name), "state.json"));
        if (!spec?.unit) continue;
        let unit: Unit;
        try { unit = checkUnit(spec.unit, name); } catch { continue; }
        const s: Sup = { unit, source: spec.source, file: spec.file, state: st?.state ?? "stopped", run: st?.run ?? 0, want: !!st?.want, restarts: st?.restarts ?? 0,
            startedAt: st?.startedAt, readyAt: st?.readyAt, lastExit: st?.lastExit, logOff: st?.logOff ?? 0, logIno: st?.logIno, carry: "" };
        units.set(name, s);
        // env.pending.json is from versions that kept one-shot env next to the spec; it may hold secrets
        rmSync(join(unitDir(name), "env.pending.json"), { force: true });
        // the stop deadline lives in memory only: give a unit caught in "stopping" a fresh one
        if (s.state === "stopping") s.stopDeadline = Date.now() + (unit.stop?.timeoutMs ?? 10_000);
        // the next tick finds exit.json / a dead holder; a live holder is simply adopted
        if (["starting", "running", "ready", "stopping"].includes(s.state)) {
            const holder = (() => { try { return pidOf(name, s.run, "holder.pid"); } catch { return null; } })();
            const ours = isOurs(holder, "holder.ts", runDir(name, s.run));
            if (!ours && !existsSync(join(runDir(name, s.run), "exit.json"))) {
                // after a reboot the pid may belong to an unrelated process: the run is gone, the next tick restarts per policy
                rmSync(join(runDir(name, s.run), "holder.pid"), { force: true });
                rmSync(join(runDir(name, s.run), "child.pid"), { force: true });
                rmSync(join(runDir(name, s.run), "env.json"), { force: true });
            }
            emit(name, "adopted", { holderPid: holder, alive: ours });
        }
        if (s.state === "backoff") s.nextAt = Date.now();
    }
}

async function scanFiles(autostart: boolean) {
    const seen = new Set<string>();
    const errors: string[] = [];
    for (const d of UNIT_DIRS) {
        const dir = expand(d);
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir).sort()) {
            if (!UNIT_FILE.test(f)) continue;
            const path = join(dir, f);
            try {
                const unit = await loadUnitFile(path);
                if (seen.has(unit.name)) throw new Error(`duplicate unit name ${unit.name}`);
                seen.add(unit.name);
                const prev = units.get(unit.name);
                const changed = !prev || JSON.stringify(prev.unit) !== JSON.stringify(unit);
                const s = register(unit, "file", path);
                if (changed) emit(unit.name, prev ? "changed" : "loaded", { file: path });
                // autostart only for units hyperd has not seen before; known ones keep their recovered want/state
                if (autostart && !prev && (unit.autostart ?? kindOf(unit) === "service") && !s.want && ["stopped", "exited", "failed"].includes(s.state)) start(s);
            } catch (error: any) {
                errors.push(String(error?.message ?? error).startsWith(f) ? String(error.message) : `${f}: ${error?.message ?? error}`);
            }
        }
    }
    return { units: [...seen], errors };
}

// ---- API --------------------------------------------------------------------------------------------
function view(s: Sup) {
    const dir = s.run ? runDir(s.unit.name, s.run) : null;
    let bytes = 0;
    try { if (dir) bytes = statSync(join(dir, "out.log")).size; } catch {}
    const pid = (() => { try { return dir ? pidOf(s.unit.name, s.run, "child.pid") : null; } catch { return null; } })();
    return { name: s.unit.name, kind: kindOf(s.unit), state: s.state, want: s.want, run: s.run, pid, source: s.source, file: s.file, owner: s.unit.owner,
        startedAt: s.startedAt, readyAt: s.readyAt, restarts: s.restarts, lastExit: s.lastExit, error: s.error, bytes, runDir: dir, unit: s.unit };
}
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) as any : {};
    if (url.pathname === "/health") return json({ ok: true, pid: process.pid, seq, units: units.size, home: HOME });
    if (url.pathname === "/status") return json({ pid: process.pid, seq, units: [...units.values()].map(view) });
    if (url.pathname === "/reload" && req.method === "POST") return json(await scanFiles(!!body.autostart));
    if (url.pathname === "/events") {
        const after = Number(url.searchParams.get("after") ?? 0);
        const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 500));
        const wait = Math.min(60_000, Number(url.searchParams.get("wait") ?? 0));
        let events = readEvents(after, limit);
        if (!events.length && wait > 0) {
            await new Promise<void>((r) => { const t = setTimeout(r, wait); waiters.add(() => { clearTimeout(t); r(); }); });
            events = readEvents(after, limit);
        }
        return json({ seq, events });
    }
    if (url.pathname === "/run" && req.method === "POST") {
        // transient unit (like systemd-run): body { unit, env? }; env is handed to the holder once and never stored in spec.json
        let unit: Unit;
        try { unit = checkUnit({ kind: "task", ...body.unit }, "run"); } catch (e: any) { return fail(e.message); }
        const prev = units.get(unit.name);
        if (prev && ["starting", "running", "ready", "stopping", "waiting", "backoff"].includes(prev.state)) return fail(`unit ${unit.name} is ${prev.state}`, 409);
        const s = register(unit, "transient", undefined, body.env);
        start(s);
        return json(view(s));
    }
    if (parts[0] !== "units") return fail("not found", 404);
    const s = parts[1] ? units.get(parts[1]) : undefined;
    if (!parts[1]) return json([...units.values()].map(view));
    if (!s) return fail(`no unit ${parts[1]}`, 404);
    const action = parts[2];
    if (!action && req.method === "GET") return json(view(s));
    if (!action && req.method === "DELETE") {
        if (["starting", "running", "ready", "stopping"].includes(s.state)) return fail(`unit ${s.unit.name} is ${s.state}; stop it first`, 409);
        units.delete(s.unit.name);
        rmSync(unitDir(s.unit.name), { recursive: true, force: true });
        emit(s.unit.name, "removed");
        return json({ removed: s.unit.name });
    }
    if (action === "start") { start(s); return json(view(s)); }
    if (action === "stop") { stop(s, body.reason ?? "stopped"); return json(view(s)); }
    if (action === "restart") {
        if (["starting", "running", "ready"].includes(s.state)) {
            stop(s, "restart");
            const until = Date.now() + (s.unit.stop?.timeoutMs ?? 10_000) + 5000;
            while (s.state === "stopping" && Date.now() < until) await Bun.sleep(100);
        }
        s.stopReason = undefined;
        start(s);
        return json(view(s));
    }
    if (action === "logs") {
        const run = Number(url.searchParams.get("run") ?? s.run);
        const dir = runDir(s.unit.name, run);
        const log = join(dir, "out.log");
        const limit = Math.max(1, Math.min(1 << 20, Number(url.searchParams.get("limit") ?? 20_000)));
        const files = run ? dayFiles(dir, "out.log") : [];
        const days = [...new Set(files.map((f) => f.day))];
        const day = url.searchParams.get("day");
        // an earlier day: its file(s) (gzipped or not) read as one text; out.log holds the current day
        const slice = (buf: Buffer, from: string | null) => {
            let off = Number(url.searchParams.get("offset") ?? -limit);
            if (off < 0) off = Math.max(0, buf.length + off);
            return json({ run, day: from, days, bytes: buf.length, offset: off, next: Math.min(buf.length, off + limit), text: buf.subarray(off, Math.min(buf.length, off + limit)).toString("utf8") });
        };
        if (day) return slice(Buffer.concat(files.filter((f) => f.day === day).map((f) => readDayFile(join(dir, f.name)))), day);
        if (!run || !existsSync(log)) {
            // the run is over and its out.log was rolled: show its last day
            const last = days.at(-1);
            return last ? slice(Buffer.concat(files.filter((f) => f.day === last).map((f) => readDayFile(join(dir, f.name)))), last) : json({ run, day: null, days, bytes: 0, offset: 0, next: 0, text: "" });
        }
        const size = statSync(log).size;
        const asked = url.searchParams.get("offset");
        // a follower whose offset is past the end: the file was rolled under it — finish the rolled file, then next: 0
        const rolled = files.filter((f) => !f.gz).at(-1);
        if (asked !== null && Number(asked) > size && rolled) {
            const buf = readFileSync(join(dir, rolled.name));
            const off = Math.min(Number(asked), buf.length);
            const end = Math.min(buf.length, off + limit);
            return json({ run, day: rolled.day, days, bytes: buf.length, offset: off, next: end >= buf.length ? 0 : end, text: buf.subarray(off, end).toString("utf8") });
        }
        let off = Number(asked ?? -limit);
        if (off < 0) off = Math.max(0, size + off);
        const text = await Bun.file(log).slice(off, Math.min(size, off + limit)).text();
        return json({ run, day: null, days, bytes: size, offset: off, next: Math.min(size, off + limit), text });
    }
    if (action === "input" && req.method === "POST") {
        const sock = join(runDir(s.unit.name, s.run), "pty.sock");
        if (!existsSync(sock)) return fail("not running", 409);
        const data = String(body.data ?? "");
        await new Promise<void>((res, rej) => {
            Bun.connect({ unix: sock, socket: { open(c) { c.write(data); c.flush(); setTimeout(() => { c.end(); res(); }, 30); }, data() {}, error(_c, e) { rej(e); }, connectError(_c, e) { rej(e); } } }).catch(rej);
        });
        return json({ written: data.length });
    }
    return fail("not found", 404);
}

// ---- boot -------------------------------------------------------------------------------------------
const SOCK = join(HOME, "hyperd.sock");
const pidFile = join(HOME, "hyperd.pid");
// single instance: the pid file is created exclusively (O_EXCL), so two daemons started at once cannot both win;
// a leftover file is taken over only when its pid is not a live hyperd (pids are reused after a reboot)
function takePidFile(): boolean {
    for (let i = 0; i < 3; i++) {
        try { const fd = openSync(pidFile, "wx", 0o600); writeSync(fd, String(process.pid)); closeSync(fd); return true; }
        catch (e: any) { if (e?.code !== "EEXIST") throw e; }
        let other = Number(readFileSync(pidFile, "utf8")) || 0;
        // an empty file is another daemon between its exclusive create and its write: look again before removing it
        if (!other) { Bun.sleepSync(100); try { other = Number(readFileSync(pidFile, "utf8")) || 0; } catch { continue; } }
        if (other && other !== process.pid && isOurs(other, "hyperd/main.ts")) return false;
        rmSync(pidFile, { force: true });
    }
    return false;
}
async function socketAnswers() {
    if (!existsSync(SOCK)) return false;
    try { return (await fetch("http://hyperd/health", { unix: SOCK, signal: AbortSignal.timeout(1000) } as any)).ok; } catch { return false; }
}
// Under launchd/systemd (HYPERD_SUPERVISED=1, set by the service file) exiting here would make KeepAlive/Restart=always
// relaunch us every few seconds (systemd then gives up for good): wait instead until the other daemon is gone.
for (let said = false; await socketAnswers() || !takePidFile(); said = true) {
    if (process.env.HYPERD_SUPERVISED !== "1") { console.error(`hyperd already running (${pidFile})`); process.exit(0); }
    if (!said) console.error(`hyperd already running (${pidFile}); waiting for it to exit`);
    await Bun.sleep(5000);
}
rmSync(SOCK, { force: true });
recover();
emit("hyperd", "daemon_started", { pid: process.pid });
const server = Bun.serve({ unix: SOCK, fetch: handle, idleTimeout: 0 } as any);
chmodSync(SOCK, 0o600);
let ticking = false;
// tick starts before unit files are read, so a slow unit file never stalls supervision of the others
setInterval(async () => { if (ticking) return; ticking = true; try { await tick(); } finally { ticking = false; } }, TICK_MS);
const scan = await scanFiles(true);
if (scan.errors.length) emit("hyperd", "unit_errors", { errors: scan.errors });
console.log(`hyperd ${process.pid} on ${SOCK}, ${units.size} units`);
const shutdown = () => { emit("hyperd", "daemon_stopping", { pid: process.pid }); server.stop(true); rmSync(SOCK, { force: true }); if (readJson(pidFile) === process.pid) rmSync(pidFile, { force: true }); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
