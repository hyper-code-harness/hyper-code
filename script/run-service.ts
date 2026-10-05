#!/usr/bin/env bun
/** Runs Hyper under launchd, applies staged fast-forward updates, and rolls code back when the new child fails health checks. */
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const runtime = resolve(root, ".runtime");
const pendingPath = resolve(runtime, "update-pending.json");
const receiptPath = resolve(runtime, "update-result.json");
const maxBytes = Math.max(1_048_576, Number(process.env.LOG_MAX_BYTES ?? 25 * 1024 * 1024));
const keep = Math.max(1, Math.min(10, Number(process.env.LOG_KEEP ?? 3)));
const port = Number(process.env.PORT ?? 3010);
let child: any = null;
let stopping = false;

function rotate(path: string, incoming = 0): void {
    let size = 0; try { size = statSync(path).size; } catch {}
    if (size + incoming <= maxBytes) return;
    rmSync(`${path}.${keep}`, { force: true });
    for (let n = keep - 1; n >= 1; n--) if (existsSync(`${path}.${n}`)) renameSync(`${path}.${n}`, `${path}.${n + 1}`);
    if (existsSync(path)) renameSync(path, `${path}.1`);
}
async function pump(stream: ReadableStream<Uint8Array>, path: string): Promise<void> {
    for await (const chunk of stream) { rotate(path, chunk.byteLength); appendFileSync(path, chunk); }
}
function command(argv: string[]): { ok: boolean; output: string } {
    const r = Bun.spawnSync(argv, { cwd: root, env: process.env, stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, output: `${r.stdout.toString()}${r.stderr.toString()}`.trim() };
}
function applyPending(): { old: string; target: string } | null {
    if (!existsSync(pendingPath)) return null;
    const p = JSON.parse(readFileSync(pendingPath, "utf8"));
    const current = command(["git", "rev-parse", "HEAD"]);
    const clean = command(["git", "status", "--porcelain=v1"]);
    if (!current.ok || current.output !== p.old || !clean.ok || clean.output) throw new Error("staged update precondition changed; refusing checkout");
    command(["git", "update-ref", `refs/hyper-update-backups/${p.requestedAt}`, p.old]);
    const reset = command(["git", "reset", "--hard", p.target]);
    if (!reset.ok) throw new Error(reset.output || "git reset failed");
    if (p.lockChanged) {
        const install = command([process.execPath, "install", "--frozen-lockfile"]);
        if (!install.ok) { command(["git", "reset", "--hard", p.old]); command([process.execPath, "install", "--frozen-lockfile"]); throw new Error(install.output || "bun install failed"); }
    }
    return { old: p.old, target: p.target };
}
async function healthy(timeoutMs = 30_000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        if (child && await Promise.race([child.exited.then(() => true), Bun.sleep(250).then(() => false)])) return false;
        try { if ((await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(1500) })).status < 500) return true; } catch {}
        await Bun.sleep(500);
    }
    return false;
}
function start() {
    child = Bun.spawn([process.execPath, "src/$main.ts"], { cwd: root, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    void pump(child.stdout as ReadableStream<Uint8Array>, resolve(runtime, "server.log"));
    void pump(child.stderr as ReadableStream<Uint8Array>, resolve(runtime, "server.error.log"));
    return child;
}
async function rollback(update: { old: string; target: string }, reason: string) {
    child?.kill("SIGTERM"); try { await child?.exited; } catch {}
    const reset = command(["git", "reset", "--hard", update.old]);
    command([process.execPath, "install", "--frozen-lockfile"]);
    writeFileSync(receiptPath, JSON.stringify({ ok: false, ...update, reason, reset: reset.output, at: Date.now() }) + "\n", { mode: 0o600 });
    rmSync(pendingPath, { force: true });
    start();
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; child?.kill(signal); });

let update: { old: string; target: string } | null = null;
try { update = applyPending(); } catch (error) {
    writeFileSync(receiptPath, JSON.stringify({ ok: false, reason: String(error), at: Date.now() }) + "\n", { mode: 0o600 });
    rmSync(pendingPath, { force: true });
}
start();
if (update) {
    if (await healthy()) {
        writeFileSync(receiptPath, JSON.stringify({ ok: true, ...update, at: Date.now() }) + "\n", { mode: 0o600 });
        rmSync(pendingPath, { force: true });
    } else await rollback(update, "new server failed health check");
}
while (!stopping && child) {
    const code = await child.exited;
    if (stopping) break;
    if (code === 75 && existsSync(pendingPath)) {
        try { update = applyPending(); start(); if (update && await healthy()) { writeFileSync(receiptPath, JSON.stringify({ ok: true, ...update, at: Date.now() }) + "\n", { mode: 0o600 }); rmSync(pendingPath, { force: true }); } else if (update) await rollback(update, "new server failed health check"); }
        catch (error) { writeFileSync(receiptPath, JSON.stringify({ ok: false, reason: String(error), at: Date.now() }) + "\n", { mode: 0o600 }); rmSync(pendingPath, { force: true }); start(); }
    } else break; // launchd restarts ordinary crashes, preserving its throttle policy.
}
process.exit(child?.exitCode ?? 1);
