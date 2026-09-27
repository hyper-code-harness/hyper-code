// Disposable SSH servers for remote.* tests.
//
// startSshFixture() generates a throwaway ed25519 key, builds and starts the two
// containers from docker-compose.yml (`plain`: no ripgrep, `rg`: with ripgrep),
// waits for sshd, and writes a private ssh_config naming them `plain` and `rg`.
// Point a test ctx at it with ctx.env.HYPER_SSH_CONFIG / HYPER_SSH_CONTROL_DIR —
// remote.sshOptions picks both up, so the user's ~/.ssh is never touched.
//
// Returns null (and the suite should skip) when Docker is not available.
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type SshFixture = {
    config: string;      // ssh_config path → HYPER_SSH_CONFIG
    controlDir: string;  // ControlMaster sockets → HYPER_SSH_CONTROL_DIR
    hosts: { plain: string; rg: string };
    env: Record<string, string>;
    stop(): Promise<void>;
};

const HERE = import.meta.dir;
const PROJECT = "hyper-ssh-test";

async function sh(cmd: string[], env?: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
    const p = Bun.spawn({ cmd, cwd: HERE, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
}

export async function dockerAvailable(): Promise<boolean> {
    try { return (await sh(["docker", "info", "--format", "{{.ServerVersion}}"])).code === 0; } catch { return false; }
}

export async function startSshFixture(): Promise<SshFixture | null> {
    if (process.env.HYPER_SKIP_DOCKER_TESTS === "1" || !(await dockerAvailable())) return null;

    // Short base path: a unix socket path must stay under ~104 bytes and %C is 40 hex chars.
    const base = `/tmp/hyper-ssh-${process.pid}`;
    rmSync(base, { recursive: true, force: true });
    const keys = join(base, "keys");
    const controlDir = join(base, "cm");
    mkdirSync(keys, { recursive: true, mode: 0o700 });
    mkdirSync(controlDir, { recursive: true, mode: 0o700 });
    const key = join(keys, "id");
    const kg = await sh(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "hyper-ssh-test", "-f", key]);
    if (kg.code !== 0) throw new Error("ssh-keygen failed: " + kg.err);

    const env = { HYPER_SSH_KEYS: keys };
    const up = await sh(["docker", "compose", "-p", PROJECT, "up", "-d", "--build", "--force-recreate", "--wait"], env);
    if (up.code !== 0) throw new Error("docker compose up failed:\n" + up.err.slice(-2000));

    const port = async (svc: string) => {
        const r = await sh(["docker", "compose", "-p", PROJECT, "port", svc, "22"], env);
        const m = /:(\d+)\s*$/.exec(r.out.trim());
        if (!m) throw new Error(`no published port for ${svc}: ${r.out}${r.err}`);
        return Number(m[1]);
    };
    const ports = { plain: await port("plain"), rg: await port("rg") };

    const config = join(base, "ssh_config");
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

    // sshd inside a fresh container needs a moment after the port opens.
    for (const host of ["plain", "rg"]) {
        let ok = false;
        for (let i = 0; i < 60 && !ok; i++) {
            ok = (await sh(["ssh", "-F", config, "-o", "BatchMode=yes", "-o", "ConnectTimeout=2", host, "true"])).code === 0;
            if (!ok) await Bun.sleep(250);
        }
        if (!ok) throw new Error(`sshd in ${host} did not come up`);
    }

    return {
        config,
        controlDir,
        hosts: { plain: "plain", rg: "rg" },
        env: { HYPER_SSH_CONFIG: config, HYPER_SSH_CONTROL_DIR: controlDir },
        async stop() {
            for (const h of ["plain", "rg"]) await sh(["ssh", "-F", config, "-O", "exit", "-o", `ControlPath=${join(controlDir, "%C")}`, h]);
            if (process.env.HYPER_KEEP_SSH_FIXTURE !== "1") await sh(["docker", "compose", "-p", PROJECT, "down", "-v", "--remove-orphans"], env);
            if (existsSync(base)) rmSync(base, { recursive: true, force: true });
        },
    };
}
