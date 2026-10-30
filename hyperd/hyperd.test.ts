import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(15_000);
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call } from "./client.ts";
import { checkUnit, loadUnitFile } from "./Unit.ts";
import { serviceFile } from "./service.ts";

const root = mkdtempSync(join(tmpdir(), "hyperd-test-"));
const home = join(root, "home");
const unitsDir = join(root, "units");
mkdirSync(unitsDir, { recursive: true });
let daemon: ReturnType<typeof Bun.spawn> | null = null;
const leaked: string[] = [];
const api = (path: string, o: { method?: string; body?: unknown } = {}) => call(path, { ...o, home });
const until = async <T>(fn: () => Promise<T | undefined | false | null>, ms = 8000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn().catch(() => undefined);
        if (v) return v as T;
        if (Date.now() > end) throw new Error("timeout waiting");
        await Bun.sleep(100);
    }
};
const unit = (name: string) => api(`/units/${name}`);
const events = async (u: string, type?: string) => (await api("/events?after=0&limit=1000")).events.filter((e: any) => e.unit === u && (!type || e.type === type));

async function startDaemon() {
    daemon = Bun.spawn(["bun", join(import.meta.dir, "main.ts")], { env: { ...process.env, HYPERD_HOME: home, HYPERD_UNITS: unitsDir, HYPERD_TICK_MS: "50" }, stdout: "ignore", stderr: "inherit" });
    await until(() => api("/health"));
}
async function stopDaemon() {
    daemon?.kill("SIGTERM");
    await daemon?.exited;
    daemon = null;
}

beforeAll(async () => {
    writeFileSync(join(unitsDir, "web.yaml"), `kind: service
cmd: "echo booting; sleep 0.3; echo 'listening on 4321'; while true; do sleep 1; done"
ready: { log: "listening on" }
logMatch: ["/listen\\\\w+ on/"]
`);
    writeFileSync(join(unitsDir, "after-web.json"), JSON.stringify({ kind: "task", cmd: "echo after", after: ["web"], autostart: true }));
    writeFileSync(join(unitsDir, "computed.ts"), `export default { kind: "task", cmd: ["bash", "-c", "echo port=$PORT"], env: { PORT: String(3000 + 7) }, autostart: true };`);
    writeFileSync(join(unitsDir, "broken.yaml"), "kind: servce\ncmd: x\n");
    await startDaemon();
});
afterAll(async () => {
    const live = (await api("/status")).units.filter((u: any) => ["running", "ready", "starting", "stopping"].includes(u.state));
    for (const u of live) await api(`/units/${u.name}/stop`, { body: {} });
    await until(async () => (await api("/status")).units.every((u: any) => !["running", "ready", "starting", "stopping"].includes(u.state)), 12_000).catch(() => undefined);
    await stopDaemon();
    // nothing may outlive the test: every holder of this root is gone
    for (const pid of Bun.spawnSync(["pgrep", "-f", root]).stdout.toString().split("\n").filter(Boolean)) { try { process.kill(Number(pid), "SIGKILL"); } catch {} leaked.push(pid); }
    rmSync(root, { recursive: true, force: true });
});

describe("Unit", () => {
    test("strict check names the bad field instead of coercing", () => {
        expect(() => checkUnit({ name: "a", cmd: "x", restart: { policy: false } })).toThrow(/restart.policy/);
        expect(() => checkUnit({ name: "a", cmd: "x", env: { PORT: 3000 } })).toThrow(/env values must be strings/);
        expect(() => checkUnit({ name: "a", cmd: "x", colour: 1 })).toThrow(/unknown key "colour"/);
        expect(() => checkUnit({ name: "a b", cmd: "x" })).toThrow(/name/);
        expect(checkUnit({ name: "a", cmd: ["true"] }).name).toBe("a");
    });
    test("TS unit files are evaluated in a subprocess and named after the file", async () => {
        const u = await loadUnitFile(join(unitsDir, "computed.ts"));
        expect(u).toMatchObject({ name: "computed", env: { PORT: "3007" } });
    });
});

describe("hyperd", () => {
    test("file units load, bad ones are reported, a service becomes ready from its log", async () => {
        const web = await until(async () => { const u = await unit("web"); return u.state === "ready" && u; });
        expect(web.kind).toBe("service");
        expect((await events("web", "log_match"))[0].line).toContain("listening on 4321");
        const errs = (await events("hyperd", "unit_errors"))[0].errors;
        expect(errs.join()).toContain("broken.yaml");
    });

    test("after: a dependent unit starts only once its dependency is ready", async () => {
        const dep = await until(async () => { const u = await unit("after-web"); return u.state === "exited" && u; });
        const [ready] = await events("web", "ready");
        const [started] = await events("after-web", "started");
        expect(started.seq).toBeGreaterThan(ready.seq);
        expect(dep.lastExit.code).toBe(0);
    });

    test("a task runs once and its log is readable by offset", async () => {
        await until(async () => (await unit("computed")).state === "exited");
        const all = await api("/units/computed/logs?offset=0");
        expect(all.text.trim()).toBe("port=3007");
        const part = await api("/units/computed/logs?offset=5&limit=4");
        expect(part.text).toBe("3007");
        expect(part.next).toBe(9);
    });

    test("transient run with one-shot env: exit code and failure are reported, env is not stored", async () => {
        await api("/run", { body: { unit: { name: "tr1", cmd: "echo secret=$TOKEN; exit 3" }, env: { TOKEN: "s3cr3t" } } });
        const u = await until(async () => { const x = await unit("tr1"); return x.state === "failed" && x; });
        expect(u.lastExit).toMatchObject({ code: 3, reason: "exit" });
        expect((await api("/units/tr1/logs")).text).toContain("secret=s3cr3t");
        expect(readFileSync(join(home, "units/tr1/spec.json"), "utf8")).not.toContain("s3cr3t");
        await expect(api("/run", { body: { unit: { name: "bad name", cmd: "x" } } })).rejects.toThrow(/name/);
    });

    test("pty session keeps shell state across inputs", async () => {
        await api("/run", { body: { unit: { name: "sh", kind: "session", cmd: ["bash", "--norc", "-i"] } } });
        await until(async () => (await unit("sh")).state === "ready");
        await Bun.sleep(300);
        await api("/units/sh/input", { body: { data: "export X=41\n" } });
        await api("/units/sh/input", { body: { data: "echo value=$((X+1))\n" } });
        await until(async () => (await api("/units/sh/logs")).text.includes("value=42"));
    });

    test("restart policy with backoff gives up after maxRestarts", async () => {
        await api("/run", { body: { unit: { name: "crashy", kind: "service", cmd: "exit 1", restart: { policy: "on-failure", backoffMs: [50, 100], maxRestarts: 2 } } } });
        const u = await until(async () => { const x = await unit("crashy"); return x.state === "failed" && x; });
        expect(u.run).toBe(3);
        expect((await events("crashy", "gave_up")).length).toBe(1);
        expect((await events("crashy", "restarting")).map((e: any) => e.inMs)).toEqual([50, 100]);
    });

    test("stop signals the whole process group and records the reason", async () => {
        await api("/run", { body: { unit: { name: "tree", cmd: "sleep 300 & sleep 300 & wait" } } });
        const u = await until(async () => { const x = await unit("tree"); return x.state === "ready" && x.pid && x; });
        await api("/units/tree/stop", { body: { reason: "test" } });
        const done = await until(async () => { const x = await unit("tree"); return x.state === "exited" && x; });
        expect(done.lastExit.reason).toBe("test");
        const ps = Bun.spawnSync(["pgrep", "-g", String(u.pid)]).stdout.toString().trim();
        expect(ps).toBe("");
    });

    test("ttlMs stops a run that lives too long", async () => {
        await api("/run", { body: { unit: { name: "ttl", cmd: "sleep 30", ttlMs: 300 } } });
        const u = await until(async () => { const x = await unit("ttl"); return x.state === "exited" && x; });
        expect(u.lastExit.reason).toBe("ttl");
    });

    test("processes survive a daemon restart; an exit while it was down is reported after", async () => {
        await api("/run", { body: { unit: { name: "longrun", cmd: "sleep 1.5; echo finished-while-down; exit 4" } } });
        const before = await until(async () => { const x = await unit("longrun"); return x.pid && x; });
        const web = await unit("web");
        const seqBefore = (await api("/health")).seq;
        await stopDaemon();
        await Bun.sleep(2000);
        await startDaemon();
        const after = await until(async () => { const x = await unit("longrun"); return x.state === "failed" && x; });
        expect(after.pid).toBe(before.pid);
        expect(after.lastExit.code).toBe(4);
        expect((await api("/units/longrun/logs")).text).toContain("finished-while-down");
        // the long-running service was adopted, not restarted, and the finished task did not run again
        const webNow = await unit("web");
        expect(webNow).toMatchObject({ pid: web.pid, run: web.run, state: "ready" });
        expect((await unit("computed")).run).toBe(1);
        const evs = (await api(`/events?after=${seqBefore}`)).events;
        expect(evs.some((e: any) => e.unit === "longrun" && e.type === "exited" && e.code === 4)).toBe(true);
        expect(evs.some((e: any) => e.unit === "web" && e.type === "adopted")).toBe(true);
    }, 20_000);

    test("events long-poll wakes on the next event", async () => {
        const { seq } = await api("/health");
        const t0 = Date.now();
        const p = api(`/events?after=${seq}&wait=5000`);
        await Bun.sleep(200);
        await api("/run", { body: { unit: { name: "ping", cmd: "true" } } });
        const r = await p;
        expect(r.events[0].unit).toBe("ping");
        expect(Date.now() - t0).toBeLessThan(3000);
    });
});

describe("daily logs", () => {
    test("logs of a finished run whose out.log was rolled: the last day by default, any day by ?day=, gzipped too", async () => {
        await api("/run", { body: { unit: { name: "daily", cmd: "echo today-line" } } });
        const u = await until(async () => { const x = await unit("daily"); return x.state === "exited" && x; });
        const dir = u.runDir as string;
        await until(async () => (await api("/units/daily/logs")).text.includes("today-line"));
        // what the holder and tidy leave behind after two midnights: an older gzipped day and the last day
        writeFileSync(join(dir, "out.2026-10-27.log.gz"), Bun.gzipSync(Buffer.from("older-day\n")));
        renameSync(join(dir, "out.log"), join(dir, "out.2026-10-28.log"));
        const last = await api("/units/daily/logs");
        expect(last).toMatchObject({ day: "2026-10-28", days: ["2026-10-27", "2026-10-28"] });
        expect(last.text).toContain("today-line");
        expect((await api("/units/daily/logs?day=2026-10-27&offset=0")).text).toBe("older-day\n");
    });
    test("a follower past the end of a just-rolled out.log finishes the rolled file, then restarts at 0", async () => {
        await api("/run", { body: { unit: { name: "follow", kind: "service", cmd: "echo before-roll; while true; do sleep 1; done" } } });
        const u = await until(async () => { const x = await unit("follow"); return x.state === "ready" && x; });
        const first = await until(async () => { const r = await api("/units/follow/logs?offset=0"); return r.text.includes("before-roll") && r; });
        const dir = u.runDir as string;
        renameSync(join(dir, "out.log"), join(dir, "out.2026-10-28.log"));
        writeFileSync(join(dir, "out.log"), "x");
        const r = await api(`/units/follow/logs?offset=${first.next + 5}`);
        expect(r).toMatchObject({ day: "2026-10-28", next: 0 });
        await api("/units/follow/stop", { body: {} });
    });
});

describe("cleanup", () => {
    test("pty session stops on SIGHUP by default", async () => {
        await api("/units/sh/stop", { body: {} });
        const u = await until(async () => { const x = await unit("sh"); return x.state === "exited" && x; });
        expect(u.lastExit.signal ?? u.lastExit.code).toBeDefined();
        const [ev] = (await events("sh", "stopping")).slice(-1);
        expect(ev.signal).toBe("SIGHUP");
    });
});

describe("install", () => {
    const o = { bun: "/usr/local/bin/bun", repo: "/srv/hyper & co", user: "ann", home: "/home/ann" };
    test("launchd system plist runs as the user, survives hyper (own process group) and escapes XML", async () => {
        const f = serviceFile("launchd-system", o);
        expect(f.path).toBe("/Library/LaunchDaemons/com.hyper.ann-hyperd.plist");
        expect(f.install.join("\n")).toContain("install -m 644 -o root -g wheel com.hyper.ann-hyperd.plist");
        expect(serviceFile("launchd-user", o).path).toBe("/home/ann/Library/LaunchAgents/com.hyper.ann-hyperd.plist");
        expect(serviceFile("launchd-system", { ...o, user: "a b" }).name).toBe("com.hyper.a-b-hyperd.plist");
        expect(f.content).toContain("<key>UserName</key><string>ann</string>");
        expect(f.content).toContain("<string>/srv/hyper &amp; co/hyperd/main.ts</string>");
        expect(f.content).toContain("<key>AbandonProcessGroup</key><true/>");
        expect(f.install.join("\n")).toContain("sudo launchctl bootstrap system");
        if (process.platform === "darwin") {
            const p = join(root, "t.plist");
            writeFileSync(p, f.content);
            expect(Bun.spawnSync(["plutil", "-lint", p]).exitCode).toBe(0);
        }
        expect(serviceFile("launchd-user", o).content).not.toContain("UserName");
        // the daemon must not load the repo .env into the env it hands to units
        expect(f.content).toContain("<string>--no-env-file</string>");
    });

    test("the service PATH starts with bun's own directory when it is not a standard one", () => {
        const at = (bun: string) => /<key>PATH<\/key><string>([^<]*)<\/string>/.exec(serviceFile("launchd-user", { ...o, bun }).content)![1]!;
        expect(at("/home/ann/.bun/bin/bun")).toBe("/home/ann/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
        expect(at("/usr/local/bin/bun")).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
        expect(serviceFile("systemd-user", { ...o, bun: "/home/ann/.bun/bin/bun" }).content).toContain("PATH=/home/ann/.bun/bin:/opt/homebrew/bin");
    });
    test("systemd unit keeps holders alive when the daemon stops", () => {
        const f = serviceFile("systemd-user", o);
        expect(f.path).toBe("/home/ann/.config/systemd/user/hyperd.service");
        expect(f.content).toContain("KillMode=process");
        expect(f.content).toContain('ExecStart=/usr/local/bin/bun --no-env-file "/srv/hyper & co/hyperd/main.ts"');
        expect(f.content).not.toContain("User=");
        expect(f.install.join("\n")).toContain("enable-linger ann");
        expect(serviceFile("systemd-system", o).content).toContain("User=ann");
        expect(serviceFile("systemd-system", o).path).toBe("/etc/systemd/system/hyperd-ann.service");
        expect(serviceFile("systemd-system", o).install.join("\n")).toContain("enable --now hyperd-ann");
        expect(f.content).toContain("Environment=HYPERD_SUPERVISED=1");
        expect(serviceFile("launchd-user", o).content).toContain("<key>HYPERD_SUPERVISED</key><string>1</string>");
    });
    test("doctor reports a daemon that is not OS-supervised and still passes the PTY check", async () => {
        const r = Bun.spawnSync(["bun", join(import.meta.dir, "cli.ts"), "doctor"], { env: { ...process.env, HYPERD_HOME: home, HYPERD_UNITS: unitsDir } });
        const out = r.stdout.toString();
        expect(out).toMatch(/ok\s+daemon answers/);
        expect(out).toMatch(/FAIL supervised by the OS/);
        expect(out).toMatch(/FAIL unit files valid .*broken/);
        expect(out).toMatch(/ok\s+pty run/);
        expect(r.exitCode).toBe(1);
    });
});
