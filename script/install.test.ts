import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const script = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
// Execute only password setup: never run prerequisites, Docker, networking or services.
const start = script.indexOf("# The password:");
const end = script.indexOf('# An install from before', start);
if (start < 0 || end < 0) throw new Error("Installer password block not found");
const passwordSetup = script.slice(start, end);
const scratch = new URL("../.hyper/tmp/install-test/", import.meta.url);
mkdirSync(scratch, { recursive: true });

function withEnv(run: (dir: string, env: string) => void) {
    const dir = mkdtempSync(join(scratch.pathname, "case-"));
    try { run(dir, join(dir, ".env")); }
    finally { rmSync(dir, { recursive: true, force: true }); }
}

function setup(env: string) {
    return Bun.spawnSync(["bash", "-c", 'set -euo pipefail\nDBENV="$1"\n' + passwordSetup + '\nprintf "%s" "$DB_PW"', "install-test", env]);
}

describe("install database password", () => {
    test("creates a private password file on first run", () => withEnv((_dir, env) => {
        const result = setup(env);
        expect(result.exitCode).toBe(0);
        const password = result.stdout.toString();
        expect(password).toMatch(/^[a-f0-9]{48}$/);
        expect(readFileSync(env, "utf8")).toBe(`HYPER_DB_PASSWORD=${password}\n`);
        expect(statSync(env).mode & 0o777).toBe(0o600);
    }));

    test("preserves the last existing password and other settings", () => withEnv((_dir, env) => {
        const original = "OTHER=value\nHYPER_DB_PASSWORD=old\nHYPER_DB_PASSWORD=existing-test-password\n";
        writeFileSync(env, original);
        const result = setup(env);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toBe("existing-test-password");
        expect(readFileSync(env, "utf8")).toBe(original);
    }));

    test("generates a password when the existing file has none", () => withEnv((_dir, env) => {
        writeFileSync(env, "OTHER=value\n");
        const result = setup(env);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toMatch(/^[a-f0-9]{48}$/);
        expect(readFileSync(env, "utf8")).toBe(`OTHER=value\nHYPER_DB_PASSWORD=${result.stdout.toString()}\n`);
    }));

    test("keeps real read errors fatal and visible", () => withEnv((_dir, env) => {
        mkdirSync(env);
        const result = setup(env);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).not.toBe("");
        expect(statSync(env).isDirectory()).toBe(true);
    }));

    test("does not replace a dangling env symlink", () => withEnv((dir, env) => {
        symlinkSync(join(dir, "missing"), env);
        const result = setup(env);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).not.toBe("");
    }));
});
