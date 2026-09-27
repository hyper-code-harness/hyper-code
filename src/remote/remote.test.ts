// remote.* and the host-aware tools against disposable sshd containers.
//
// test/ssh/fixture.ts builds two Alpine sshd images (docker compose project
// `hyper-ssh-test`): `plain` has no ripgrep (grep/find fallbacks), `rg` has it.
// The ctx is pointed at a private ssh_config + ControlMaster dir through
// HYPER_SSH_CONFIG / HYPER_SSH_CONTROL_DIR, so the developer's ~/.ssh is never
// read or written. Without Docker (or with HYPER_SKIP_DOCKER_TESTS=1) the whole
// suite is skipped, not failed.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";
import { startSshFixture, dockerAvailable, type SshFixture } from "../../test/ssh/fixture";

const enabled = process.env.HYPER_SKIP_DOCKER_TESTS !== "1" && await dockerAvailable();
if (!enabled) console.warn("[remote.test] Docker unavailable or HYPER_SKIP_DOCKER_TESTS=1 — skipping");
const LOCAL = join(import.meta.dir, "../../.test-tmp/remote");

let fx: SshFixture | null = null;
let ctx: any;

describe.skipIf(!enabled)("remote over ssh (docker sshd)", () => {
    beforeAll(async () => {
        fx = await startSshFixture();
        if (!fx) throw new Error("ssh fixture unavailable");
        ctx = await mkTestCtx({ db: false, env: fx.env });
        rmSync(LOCAL, { recursive: true, force: true });
        mkdirSync(LOCAL, { recursive: true });
    }, 240_000);

    afterAll(async () => {
        await fx?.stop();
        rmSync(LOCAL, { recursive: true, force: true });
    }, 60_000);

    const R = () => ctx.fns.remote;
    const T = () => ctx.fns.tools;

    test("servers reads HYPER_SSH_CONFIG, not ~/.ssh/config", async () => {
        const list = await R().servers({});
        expect(list.map((s: any) => s.name).sort()).toEqual(["plain", "rg"]);
        expect(list[0]).toMatchObject({ hostname: "127.0.0.1", user: "tester" });
    });

    test("quote keeps ~ expandable and everything else literal", async () => {
        expect(R().quote({ value: "it's" })).toBe("'it'\\''s'");
        expect(R().quote({ value: "~/a b", path: true })).toBe("~/'a b'");
        expect(R().quote({ value: "~", path: true })).toBe("~");
        expect((await R().exec({ host: "plain", command: "echo " + R().quote({ value: "~/$HOME it's", path: true }) })).stdout).toBe("/home/tester/$HOME it's\n");
    });

    test("exec: quoting, cwd, stdin, exit codes, persistent connection", async () => {
        const a = await R().exec({ host: "plain", command: `printf '%s|' "it's" 'a b' "$HOME"` });
        expect(a).toMatchObject({ exitCode: 0, stdout: "it's|a b|/home/tester|" });

        await R().exec({ host: "plain", command: "mkdir -p 'dir with space'" });
        expect((await R().exec({ host: "plain", command: "pwd", cwd: "~/dir with space" })).stdout.trim())
            .toBe("/home/tester/dir with space");

        expect((await R().exec({ host: "plain", command: "wc -c", stdin: "hello" })).stdout.trim()).toBe("5");

        const f = await R().exec({ host: "plain", command: "echo oops >&2; exit 7" });
        expect(f).toMatchObject({ exitCode: 7, stderr: "oops\n" });

        // A second call reuses the master socket: fast, and the socket file exists.
        const t0 = Date.now();
        await R().exec({ host: "plain", command: "true" });
        expect(Date.now() - t0).toBeLessThan(1500);
        const check = Bun.spawnSync(["ssh", "-F", fx!.config, "-O", "check", "-o", `ControlPath=${join(fx!.controlDir, "%C")}`, "plain"]);
        expect(check.exitCode).toBe(0);
    });

    test("exec keeps the script and exported secrets out of the remote process list", async () => {
        const r = await T().bash({ host: "plain", command: "sleep 1 & ps -ww -o args | grep -c zz-secret-42", env: { TOKEN: "zz-secret-42" } });
        // only the grep itself matches
        expect(r).toEqual({ output: "1\n", isError: false });
    });

    test("exec timeout also kills the remote process tree", async () => {
        const r = await R().exec({ host: "plain", command: "sleep 97 & sleep 98; echo never", timeout: 1 });
        expect(r.timedOut).toBe(true);
        expect(r.exitCode).toBeNull();
        await Bun.sleep(1000);
        const left = await R().exec({ host: "plain", command: "pgrep -f 'sleep 9[78]' || echo none" });
        expect(left.stdout.trim()).toBe("none");
    });

    test("readFile / writeFile: odd paths, unicode, parent dirs, errors", async () => {
        const path = "~/x/a b/it's.txt";
        const content = "line1\nпривет 'q' $HOME `x`\n";
        expect(await R().writeFile({ host: "plain", path, content })).toEqual({ bytes: Buffer.byteLength(content) });
        expect(await R().readFile({ host: "plain", path })).toBe(content);
        await expect(R().readFile({ host: "plain", path: "nope.txt" })).rejects.toThrow("not a file");
    });

    test("writeFile with expectedContent refuses to clobber a concurrent change", async () => {
        const path = "cas.txt";
        await R().writeFile({ host: "plain", path, content: "1\n" });
        const before = await R().readFile({ host: "plain", path });
        await R().exec({ host: "plain", command: "echo 2 >> cas.txt" });
        await expect(R().writeFile({ host: "plain", path, content: "mine\n", expectedContent: before })).rejects.toThrow("changed on the server");
        expect(await R().readFile({ host: "plain", path })).toBe("1\n2\n");
        // unchanged file: the guarded write goes through
        const now = await R().readFile({ host: "plain", path });
        await R().writeFile({ host: "plain", path, content: "ok\n", expectedContent: now });
        expect(await R().readFile({ host: "plain", path })).toBe("ok\n");
    });

    test("tools read/write/edit with host, literal and anchored edits", async () => {
        const path = "proj/demo.ts";
        expect(await T().write({ host: "plain", path, content: "export const a = 1;\nexport const b = 2;\n" }))
            .toStartWith("wrote plain:proj/demo.ts");
        const hash = await T().read({ host: "plain", path, hashline: true });
        const anchor = hash.split("\n")[0].split("|")[0];
        await T().edit({ host: "plain", path, edits: [{ oldText: "b = 2", newText: "b = 42" }] });
        await T().edit({ host: "plain", path, edits: [{ op: "insertAfter", anchor, text: "// inserted" }] });
        expect(await T().read({ host: "plain", path })).toBe("export const a = 1;\n// inserted\nexport const b = 42;\n");
        expect(await T().read({ host: "plain", path, startLine: 2, endLine: 2 })).toBe("// inserted");
    });

    test("bash tool with host: cwd, env, error shape, output cap, unreachable host", async () => {
        expect(await T().bash({ host: "plain", command: "echo $X; pwd", cwd: "proj", env: { X: "q'x" } }))
            .toEqual({ output: "q'x\n/home/tester/proj\n", isError: false });
        const fail = await T().bash({ host: "plain", command: "ls /nope" });
        expect(fail.isError).toBe(true);
        expect(fail.output).toMatch(/^\[exit [12]\]/);
        const big = await T().bash({ host: "plain", command: "yes abc | head -c 300000" });
        expect(big.output.length).toBeLessThan(101_000);
        expect(big.output).toContain("chars cut");
        const down = await T().bash({ host: "no-such-host.invalid", command: "true" });
        expect(down.isError).toBe(true);
        expect(down.output).toContain("[ssh no-such-host.invalid failed]");
    });

    for (const host of ["plain", "rg"] as const) {
        test(`grep/find with host (${host === "rg" ? "ripgrep" : "grep/find fallback"})`, async () => {
            await R().exec({ host, command: "rm -rf g && mkdir -p 'g/sub dir' g/node_modules g/.hidden" });
            await R().writeFile({ host, path: "g/a.ts", content: "const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n" });
            await R().writeFile({ host, path: "g/sub dir/b.md", content: "beta in markdown\n" });
            await R().writeFile({ host, path: "g/node_modules/c.ts", content: "const beta = 0;\n" });
            await R().writeFile({ host, path: "g/.hidden/d.ts", content: "const beta = 9;\n" });

            const g = await R().grep({ host, pattern: "beta", path: "g" });
            expect(g.engine).toBe(host === "rg" ? "rg" : "grep");
            expect(g.matches.map((m: any) => m.path).sort()).toEqual(["g/a.ts", "g/sub dir/b.md"]);
            expect(g.matches.find((m: any) => m.path === "g/a.ts")).toMatchObject({ line: 2, column: 7, text: "const beta = 2;" });

            const withCtx = await R().grep({ host, pattern: "beta", path: "g", glob: "*.ts", context: 1 });
            expect(withCtx.matches).toEqual([{ path: "g/a.ts", line: 2, column: 7, text: "const beta = 2;", before: ["const alpha = 1;"], after: ["const gamma = 3;"] }]);

            const hidden = await R().grep({ host, pattern: "beta", path: "g", hidden: true, glob: "*.ts" });
            expect(hidden.matches.map((m: any) => m.path).sort()).toEqual(["g/.hidden/d.ts", "g/a.ts"]);

            const lit = await R().grep({ host, pattern: "beta = 2", literal: true, path: "g/a.ts" });
            expect(lit.matches).toEqual([{ path: "g/a.ts", line: 2, column: 7, text: "const beta = 2;" }]);

            const tool = await T().grep({ host, pattern: "gamma", path: "g", hashline: true });
            expect(tool).toMatch(/^g\/a\.ts:3[0-9a-z]+:7: const gamma = 3;/);

            expect(await T().find({ host, pattern: "*.ts", path: "g" })).toBe("g/a.ts");
            expect((await R().find({ host, pattern: "sub dir/*.md", path: "g" })).paths).toEqual(["g/sub dir/b.md"]);
            await expect(R().grep({ host, pattern: "x", path: "missing" })).rejects.toThrow("no such file or directory");
        });
    }

    test("rsync push and pull, incremental, into missing parents", async () => {
        mkdirSync(join(LOCAL, "src"), { recursive: true });
        writeFileSync(join(LOCAL, "src/one.txt"), "1");
        writeFileSync(join(LOCAL, "src/two.txt"), "22");
        const up = await R().rsync({ host: "plain", direction: "push", local: join(LOCAL, "src") + "/", remote: "deep/new/dir/" });
        expect(up).toMatchObject({ files: 2, direction: "push" });
        const again = await R().rsync({ host: "plain", direction: "push", local: join(LOCAL, "src") + "/", remote: "deep/new/dir/" });
        expect(again.files).toBe(0);
        expect((await R().exec({ host: "plain", command: "cat deep/new/dir/two.txt" })).stdout).toBe("22");

        const down = await R().rsync({ host: "plain", direction: "pull", remote: "deep/new/", local: join(LOCAL, "back/x") + "/" });
        expect(down.files).toBe(2);
        expect(readFileSync(join(LOCAL, "back/x/dir/one.txt"), "utf8")).toBe("1");

        const dry = await R().rsync({ host: "plain", direction: "push", local: join(LOCAL, "src") + "/", remote: "dry/", dryRun: true, exclude: ["two.txt"] });
        expect(dry.dryRun).toBe(true);
        expect((await R().exec({ host: "plain", command: "test -e dry/one.txt && echo yes || echo no" })).stdout.trim()).toBe("no");
    });

    test("read tool shows a remote image", async () => {
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
        writeFileSync(join(LOCAL, "dot.png"), png);
        await R().rsync({ host: "plain", direction: "push", local: join(LOCAL, "dot.png"), remote: "img/dot.png" });
        const r = await T().read({ host: "plain", path: "img/dot.png" });
        expect(r.output).toBe("[image: plain:img/dot.png]");
        expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    });

    test("background jobs: start, jobs, logs, stop, restart guard", async () => {
        const s = await R().start({ host: "plain", name: "tick", command: "for i in $(seq 1 60); do echo tick $i \"$X\"; sleep 0.5; done", env: { X: "it's" }, wait: 1.2 });
        expect(s).toMatchObject({ name: "tick", session: "hyper-tick", running: true });
        expect(s.tail).toContain("tick 1 it's");
        await expect(R().start({ host: "plain", name: "tick", command: "true", wait: 0 })).rejects.toThrow("already running");
        expect((await R().jobs({ host: "plain" })).find((j: any) => j.name === "tick")).toMatchObject({ running: true });
        const l = await R().logs({ host: "plain", name: "tick", grep: "tick [12] " });
        expect(l.tail.trim().split("\n")).toEqual(["tick 1 it's", "tick 2 it's"]);
        expect(await R().stop({ host: "plain", name: "tick", grace: 2 })).toMatchObject({ wasRunning: true });
        expect((await R().logs({ host: "plain", name: "tick" })).running).toBe(false);
        const done = await R().start({ host: "plain", name: "quick", command: "echo hi; exit 3", wait: 1 });
        expect(done.running).toBe(false);
        expect(done.tail).toContain("[exit 3]");
    });

    test("status on Linux and for an unreachable host", async () => {
        const s = await R().status({ host: "plain" });
        expect(s).toMatchObject({ reachable: true, hostname: expect.any(String) });
        expect(s.os).toContain("Alpine");
        expect(s.cpus).toBeGreaterThan(0);
        const bad = await R().status({ host: "no-such-host.invalid" });
        expect(bad.reachable).toBe(false);
    });

    test("close drops the master; the next call reconnects", async () => {
        expect((await R().close({ host: "plain" })).closed).toEqual(["plain"]);
        expect((await R().exec({ host: "plain", command: "echo back" })).stdout).toBe("back\n");
    });
});
