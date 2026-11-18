import { afterEach, expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import registry from "./accountRegistry";
import remove from "./removeAccount";
import login from "./startAccountLogin";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
function root() { return { accountCredentialCache: new Map(), accountInventoryCache: new Map(), claudeCodeTokens: new Map(), accountCredentialRevision: 10, accountLogins: new Map() }; }
function fixture() {
    const home = mkdtempSync(`${tmpdir()}/account-hooks-mock-`); cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    const ctx: any = { env: { HOME: home }, state: { llm: root() }, fns: { llm: {
        accountCredentialPath: () => ({ dir: `${home}/work`, file: `${home}/work/auth.json`, keychainService: null }),
        accountAuthHealth: async () => [], accountCredentialExists: async () => false,
    }, procs: { db: { select: async () => [], run: async () => ({}) }, events: { refresh: () => {} } } } };
    ctx.fns.llm.accountRegistry = (o: any) => registry(ctx, null, o);
    return ctx;
}
function cleared(ctx: any) {
    expect(ctx.state.llm.accountCredentialCache).toBeUndefined();
    expect(ctx.state.llm.accountInventoryCache).toBeUndefined(); expect(ctx.state.llm.claudeCodeTokens).toBeUndefined();
    expect(ctx.state.llm.accountCredentialRevision).toBeGreaterThan(10);
}
test("registry reads preserve cache; every account mutation clears maps and advances revision", async () => {
    const ctx = fixture(); const previous = ctx.state.llm.accountCredentialCache;
    await registry(ctx, null, { action: "list" }); expect(ctx.state.llm.accountCredentialCache).toBe(previous);
    for (const action of ["begin", "connect", "fail", "remove"] as const) {
        ctx.state.llm = root(); await registry(ctx, null, { action, provider: "codex", account: "work" }); cleared(ctx);
    }
});
test("removing an account invalidates before and after removal and cancels pending login ownership", async () => {
    const ctx = fixture(); let killed = false;
    ctx.state.llm.accountLogins.set("codex:work", { status: "pending", proc: { kill() { killed = true; expect(ctx.state.llm.accountLogins.has("codex:work")).toBe(false); } } });
    const run = ctx.fns.procs.db.run;
    ctx.fns.procs.db.run = async (opts: any) => { ctx.state.llm.accountInventoryCache = new Map(); return run(opts); };
    await remove(ctx, null, { provider: "codex", account: "work" }); cleared(ctx); expect(killed).toBe(true);
});
test("login completion awaits a forced probe and does not treat Promise<false> as connected", async () => {
    const ctx = fixture();
    const proc: any = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {};
    const spawn = spyOn(childProcess, "spawn").mockImplementation((() => {
        setTimeout(() => proc.stdout.emit("data", Buffer.from("https://example.invalid/login")), 0); return proc;
    }) as any); cleanup.push(() => spawn.mockRestore());
    let finish!: (v: boolean) => void; let forced = false;
    ctx.fns.llm.accountCredentialExists = (opts: any) => { forced = opts.force; return new Promise((resolve) => { finish = resolve; }); };
    await login(ctx, null, { provider: "codex", account: "work" });
    proc.emit("exit", 0); expect(forced).toBe(true);
    const flow = ctx.state.llm.accountLogins.get("codex:work"); expect(flow.status).toBe("pending");
    finish(false); await Bun.sleep(1); expect(flow.status).toBe("failed"); cleared(ctx);
});
