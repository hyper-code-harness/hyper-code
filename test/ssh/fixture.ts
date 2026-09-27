// Long-lived SSH servers for remote.* tests.
//
// startSshFixture() makes sure the two containers from docker-compose.yml are up
// (`plain`: no ripgrep, `rg`: with ripgrep) and returns a private ssh_config
// naming them `plain` and `rg`. The containers stay running between test runs:
// the next run reuses them in well under a second instead of rebuilding.
//
// Everything is scoped to this checkout: the compose project name is derived
// from the checkout path, and the throwaway key lives in .test-tmp/ssh-fixture.
// Two checkouts get two independent pairs of containers.
//
// Point a test ctx at it with ctx.env.HYPER_SSH_CONFIG / HYPER_SSH_CONTROL_DIR —
// remote.sshOptions picks both up, so the user's ~/.ssh is never touched.
// Each run starts from a clean home (everything but ~/.ssh is removed) and
// without leftover tmux jobs, so tests need not clean up after themselves.
//
//   HYPER_SSH_FIXTURE_DOWN=1   stop() removes the containers after the run
//   HYPER_SKIP_DOCKER_TESTS=1  skip the suite
//   docker compose -p <project> down -v   remove by hand (project printed on start)
//
// Returns null (and the suite should skip) when Docker is not available.
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SshFixture = {
    config: string;      // ssh_config path → HYPER_SSH_CONFIG
    controlDir: string;  // ControlMaster sockets → HYPER_SSH_CONTROL_DIR
    project: string;     // docker compose project name
    hosts: { plain: string; rg: string };
    env: Record<string, string>;
    stop(): Promise<void>;
};

const HERE = import.meta.dir;
const CHECKOUT = join(HERE, "..", "..");
// Stable per checkout, short enough for container names.
const PROJECT = `hyper-ssh-${Bun.hash(CHECKOUT).toString(36).slice(0, 8)}`;
const STATE = join(CHECKOUT, ".test-tmp", "ssh-fixture");
const SERVICES = ["plain", "rg"] as const;

async function sh(cmd: string[], env?: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
    const p = Bun.spawn({ cmd, cwd: HERE, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
}

export async function dockerAvailable(): Promise<boolean> {
    try { return (await sh(["docker", "info", "--format", "{{.ServerVersion}}"])).code === 0; } catch { return false; }
}

// Fingerprint of what the containers are built from: a change rebuilds them.
function buildHash(): string {
    return Bun.hash(["Dockerfile", "entrypoint.sh", "docker-compose.yml"].map(f => readFileSync(join(HERE, f), "utf8")).join("\0")).toString(36);
}

export async function startSshFixture(): Promise<SshFixture | null> {
    if (process.env.HYPER_SKIP_DOCKER_TESTS === "1" || !(await dockerAvailable())) return null;

    mkdirSync(STATE, { recursive: true, mode: 0o700 });
    const keys = join(STATE, "keys");
    mkdirSync(keys, { recursive: true, mode: 0o700 });
    const key = join(keys, "id");
    if (!existsSync(key)) {
        const kg = await sh(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "hyper-ssh-test", "-f", key]);
        if (kg.code !== 0) throw new Error("ssh-keygen failed: " + kg.err);
    }
    // A unix socket path must stay under ~104 bytes and %C is 40 hex chars:
    // the checkout path can be long, so master sockets live under /tmp.
    const controlDir = `/tmp/${PROJECT}-cm`;
    mkdirSync(controlDir, { recursive: true, mode: 0o700 });
    const env = { HYPER_SSH_KEYS: keys };
    const compose = (...args: string[]) => sh(["docker", "compose", "-p", PROJECT, ...args], env);

    // Reuse running containers built from the current files; otherwise (re)create.
    const stamp = join(STATE, "build-hash");
    const want = buildHash();
    const running = (await compose("ps", "--status", "running", "--services")).out.split("\n").filter(Boolean);
    const fresh = existsSync(stamp) && readFileSync(stamp, "utf8") === want;
    if (!fresh || !SERVICES.every(s => running.includes(s))) {
        const up = await compose("up", "-d", "--build", "--wait", ...(fresh ? [] : ["--force-recreate"]));
        if (up.code !== 0) throw new Error("docker compose up failed:\n" + up.err.slice(-2000));
        writeFileSync(stamp, want);
        console.warn(`[ssh-fixture] containers up: docker compose -p ${PROJECT} (they stay running; HYPER_SSH_FIXTURE_DOWN=1 removes them after the run)`);
    }

    const port = async (svc: string) => {
        const r = await compose("port", svc, "22");
        const m = /:(\d+)\s*$/.exec(r.out.trim());
        if (!m) throw new Error(`no published port for ${svc}: ${r.out}${r.err}`);
        return Number(m[1]);
    };
    const ports = { plain: await port("plain"), rg: await port("rg") };

    const config = join(STATE, "ssh_config");
    writeFileSync(config, Object.entries(ports).map(([name, p]) => [
        `Host ${name}`,
        `  HostName 127.0.0.1`,
        `  Port ${p}`,
        `  User tester`,
        `  IdentityFile ${key}`,
        `  IdentitiesOnly yes`,
        `  StrictHostKeyChecking no`,
        `  UserKnownHostsFile /dev/null`,
        `  LogLevel ERROR`,
        "",
    ].join("\n")).join("\n"));

    // Stale masters from a previous run point at old ports; drop them.
    for (const h of SERVICES) await sh(["ssh", "-F", config, "-O", "exit", "-o", `ControlPath=${join(controlDir, "%C")}`, h]);

    // sshd inside a fresh container needs a moment after the port opens.
    for (const host of SERVICES) {
        let ok = false;
        for (let i = 0; i < 60 && !ok; i++) {
            ok = (await sh(["ssh", "-F", config, "-o", "BatchMode=yes", "-o", "ConnectTimeout=2", host, "true"])).code === 0;
            if (!ok) await Bun.sleep(250);
        }
        if (!ok) throw new Error(`sshd in ${host} did not come up (docker compose -p ${PROJECT} logs)`);
    }

    // Containers persist, test data must not: start every run from an empty
    // home (keeping .ssh), no leftover tmux jobs and no stray /tmp probes.
    for (const host of SERVICES) {
        const r = await sh(["ssh", "-F", config, "-o", "BatchMode=yes", host,
            "tmux kill-server 2>/dev/null; pkill -u tester -x sleep 2>/dev/null; find ~ -mindepth 1 -maxdepth 1 ! -name .ssh -exec rm -rf {} +; rm -rf /tmp/pwn-* 2>/dev/null; true"]);
        if (r.code !== 0) throw new Error(`could not reset ${host}: ${r.err}`);
    }

    return {
        config,
        controlDir,
        project: PROJECT,
        hosts: { plain: "plain", rg: "rg" },
        env: { HYPER_SSH_CONFIG: config, HYPER_SSH_CONTROL_DIR: controlDir },
        async stop() {
            for (const h of SERVICES) await sh(["ssh", "-F", config, "-O", "exit", "-o", `ControlPath=${join(controlDir, "%C")}`, h]);
            if (process.env.HYPER_SSH_FIXTURE_DOWN === "1") {
                await compose("down", "-v", "--remove-orphans");
                rmSync(STATE, { recursive: true, force: true });
                rmSync(controlDir, { recursive: true, force: true });
            }
        },
    };
}
