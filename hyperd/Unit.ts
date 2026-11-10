// hyperd unit: a declarative description of one process. Files (YAML, JSON/JSONC, TS) and transient
// units created through the API both end up as a checked Unit object, stored as JSON in the state dir.

export type ReadyCheck = {
    /** GET this URL; ready on 2xx. */
    http?: string;
    /** host:port or port; ready when a TCP connect succeeds. */
    tcp?: string | number;
    /** Command; ready when it exits 0. */
    exec?: string[];
    /** Substring (or /regex/) that must appear in the output. */
    log?: string;
    /** Give up after this long and mark the run unhealthy. @default 60000 */
    timeoutMs?: number;
    /** Probe period. @default 500 */
    intervalMs?: number;
};

export type Unit = {
    /** Unique name: letters, digits, dot, dash, underscore. */
    name: string;
    /** service = keep alive; task = run once; session = interactive terminal. @default "service" */
    kind?: "service" | "task" | "session";
    /** argv, or a shell string run through bash -lc. */
    cmd: string[] | string;
    cwd?: string;
    env?: Record<string, string>;
    /** Start only after these units are ready. */
    after?: string[];
    ready?: ReadyCheck;
    restart?: {
        /** @default "on-failure" for service, "no" otherwise */
        policy?: "no" | "on-failure" | "always";
        /** [first, max] backoff between restarts. @default [1000, 30000] */
        backoffMs?: [number, number];
        /** Give up after this many restarts in a row. @default 0 = unlimited */
        maxRestarts?: number;
    };
    stop?: {
        /** @default "SIGTERM" */
        signal?: string;
        /** Initial signal recipient. Use process for a graceful wrapper; timeout escalation always kills the group. @default "group" */
        target?: "group" | "process";
        /** SIGKILL after this long. @default 10000 */
        timeoutMs?: number;
    };
    /** Stop a still-running process after this long. */
    ttlMs?: number;
    /** Run in a pseudo-terminal (needed for attach and interactive programs). @default true for session */
    pty?: boolean | { cols?: number; rows?: number };
    /** Output patterns (substring or /regex/) that emit a log_match event. */
    logMatch?: string[];
    /** Start when hyperd starts. @default true for file units of kind service */
    autostart?: boolean;
    /** Who owns it, e.g. "agent:bi" or "job:j123". */
    owner?: string;
    labels?: Record<string, string>;
};

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/; // no leading dot: "." and ".." would escape units/
const KEYS = new Set(["name", "kind", "cmd", "cwd", "env", "after", "ready", "restart", "stop", "ttlMs", "pty", "logMatch", "autostart", "owner", "labels"]);

/** Strict check: unknown keys and wrong types are errors with a path, never silently coerced. */
export function checkUnit(raw: unknown, where = "unit"): Unit {
    const errs: string[] = [];
    const u = raw as any;
    if (!u || typeof u !== "object" || Array.isArray(u)) throw new Error(`${where}: must be an object`);
    for (const k of Object.keys(u)) if (!KEYS.has(k)) errs.push(`unknown key "${k}"`);
    const str = (v: any) => typeof v === "string";
    const strMap = (v: any) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(str);
    const num = (v: any) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (!str(u.name) || !NAME.test(u.name)) errs.push(`name must match ${NAME}`);
    if (u.kind !== undefined && !["service", "task", "session"].includes(u.kind)) errs.push(`kind must be service | task | session`);
    if (!(str(u.cmd) && u.cmd.trim()) && !(Array.isArray(u.cmd) && u.cmd.length && u.cmd.every(str))) errs.push("cmd must be a non-empty string or string[]");
    if (u.cwd !== undefined && !str(u.cwd)) errs.push("cwd must be a string");
    if (u.env !== undefined && !strMap(u.env)) errs.push("env values must be strings (quote numbers and booleans)");
    if (u.labels !== undefined && !strMap(u.labels)) errs.push("labels values must be strings");
    if (u.after !== undefined && !(Array.isArray(u.after) && u.after.every(str))) errs.push("after must be string[]");
    if (u.logMatch !== undefined && !(Array.isArray(u.logMatch) && u.logMatch.every(str))) errs.push("logMatch must be string[]");
    if (u.ttlMs !== undefined && !num(u.ttlMs)) errs.push("ttlMs must be a number >= 0");
    if (u.autostart !== undefined && typeof u.autostart !== "boolean") errs.push("autostart must be true or false");
    if (u.owner !== undefined && !str(u.owner)) errs.push("owner must be a string");
    if (u.pty !== undefined && typeof u.pty !== "boolean" && !(u.pty && typeof u.pty === "object" && ["cols", "rows"].every((k) => u.pty[k] === undefined || num(u.pty[k]))))
        errs.push("pty must be a boolean or { cols, rows }");
    if (u.ready !== undefined) {
        const r = u.ready;
        if (!r || typeof r !== "object") errs.push("ready must be an object");
        else {
            for (const k of Object.keys(r)) if (!["http", "tcp", "exec", "log", "timeoutMs", "intervalMs"].includes(k)) errs.push(`ready: unknown key "${k}"`);
            if ([r.http, r.tcp, r.exec, r.log].filter((x) => x !== undefined).length !== 1) errs.push("ready needs exactly one of http | tcp | exec | log");
            if (r.http !== undefined && !str(r.http)) errs.push("ready.http must be a URL string");
            if (r.tcp !== undefined && !str(r.tcp) && !num(r.tcp)) errs.push("ready.tcp must be host:port or a port");
            if (r.exec !== undefined && !(Array.isArray(r.exec) && r.exec.length && r.exec.every(str))) errs.push("ready.exec must be string[]");
            if (r.log !== undefined && !str(r.log)) errs.push("ready.log must be a string");
            for (const k of ["timeoutMs", "intervalMs"]) if (r[k] !== undefined && !num(r[k])) errs.push(`ready.${k} must be a number`);
        }
    }
    if (u.restart !== undefined) {
        const r = u.restart;
        if (!r || typeof r !== "object") errs.push("restart must be an object");
        else {
            for (const k of Object.keys(r)) if (!["policy", "backoffMs", "maxRestarts"].includes(k)) errs.push(`restart: unknown key "${k}"`);
            if (r.policy !== undefined && !["no", "on-failure", "always"].includes(r.policy)) errs.push(`restart.policy must be no | on-failure | always (quote "no" in YAML)`);
            if (r.backoffMs !== undefined && !(Array.isArray(r.backoffMs) && r.backoffMs.length === 2 && r.backoffMs.every(num))) errs.push("restart.backoffMs must be [first, max]");
            if (r.maxRestarts !== undefined && !num(r.maxRestarts)) errs.push("restart.maxRestarts must be a number");
        }
    }
    if (u.stop !== undefined) {
        const s = u.stop;
        if (!s || typeof s !== "object") errs.push("stop must be an object");
        else {
            for (const k of Object.keys(s)) if (!["signal", "timeoutMs", "target"].includes(k)) errs.push(`stop: unknown key "${k}"`);
            if (s.signal !== undefined && !(str(s.signal) && /^SIG[A-Z0-9]+$/.test(s.signal))) errs.push("stop.signal must look like SIGTERM");
            if (s.timeoutMs !== undefined && !num(s.timeoutMs)) errs.push("stop.timeoutMs must be a number");
            if (s.target !== undefined && !["group", "process"].includes(s.target)) errs.push("stop.target must be group | process");
        }
    }
    if (errs.length) throw new Error(`${where}: ${errs.join("; ")}`);
    return u as Unit;
}

/** Parse a unit file by extension. TS files run in a short-lived Bun subprocess so the daemon never imports user code. */
export async function loadUnitFile(path: string): Promise<Unit> {
    const base = path.split("/").pop()!;
    const name = base.replace(/\.(ya?ml|jsonc?|ts)$/, "");
    let data: any;
    if (/\.ya?ml$/.test(path)) data = Bun.YAML.parse(await Bun.file(path).text());
    else if (/\.jsonc$/.test(path)) data = (Bun as any).JSONC.parse(await Bun.file(path).text());
    else if (/\.json$/.test(path)) data = JSON.parse(await Bun.file(path).text());
    else if (/\.ts$/.test(path)) {
        const p = Bun.spawn(["bun", "-e", `const m = await import(${JSON.stringify(path)}); process.stdout.write(JSON.stringify(m.default ?? null))`], { stdout: "pipe", stderr: "pipe" });
        const t = setTimeout(() => p.kill("SIGKILL"), 10_000); // a hanging unit file must not hang the daemon
        const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        clearTimeout(t);
        if (code !== 0) throw new Error(`${base}: ${err.trim().split("\n").slice(-3).join(" ")}`);
        data = JSON.parse(out);
    } else throw new Error(`${base}: unsupported unit file type`);
    if (data && typeof data === "object" && data.name === undefined) data.name = name;
    return checkUnit(data, base);
}

export const UNIT_FILE = /\.(ya?ml|jsonc?|ts)$/;
