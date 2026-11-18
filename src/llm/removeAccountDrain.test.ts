import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import removeAccount from "./removeAccount";
import refreshClaudeCode from "./refreshClaudeCode";

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });
function fixture() {
    const home = mkdtempSync(`${tmpdir()}/remove-drain-fixture-`);
    restores.push(() => rmSync(home, { recursive: true, force: true }));
    const dir = `${home}/work`; mkdirSync(dir);
    const root: any = { accountCredentialRevision: 0, claudeCodeTokens: new Map(), claudeCodeFlights: new Set() };
    const ctx: any = { env: { HOME: home, USER: "mock-user" }, state: { llm: root }, fns: {
        llm: { accountCredentialPath: () => ({ account: "work", dir, keychainService: "mock-never-used" }), accountRegistry: async () => [] },
        procs: { db: { select: async () => [], run: async () => ({}) }, events: { refresh: () => {} } },
    } };
    const spawn = spyOn(Bun, "spawn").mockImplementation(((opts: { cmd: string[] }) => {
        expect(opts.cmd[1]).toBe("delete-generic-password");
        return { exited: Promise.resolve(0) };
    }) as any);
    restores.push(() => spawn.mockRestore());
    return { ctx, root, dir, spawn };
}

for (const lostMap of [false, true]) test(`removal drains a pending writer before deleting, including invalidated map=${lostMap}`, async () => {
    const { ctx, root, dir, spawn } = fixture();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const pending = gate.then(() => { writeFileSync(`${dir}/credentials`, "fixture-token"); return "fixture-token"; });
    root.claudeCodeFlights.add(pending);
    root.claudeCodeTokens.set("fixture", { pending });
    if (lostMap) delete root.claudeCodeTokens;
    const removing = removeAccount(ctx, null, { provider: "claude-code", account: "work" });
    // Advance the DB-select continuation without sleeping or performing real I/O.
    await Promise.resolve(); await Promise.resolve();
    expect(root.accountCredentialMutations).toBe(1);
    expect(root.claudeCodeTokens).toBeUndefined();
    expect(root.accountCredentialRevision).toBeGreaterThan(0);
    expect(existsSync(dir)).toBe(true); expect(spawn).not.toHaveBeenCalled();
    expect(await refreshClaudeCode(ctx, null, { account: "work" })).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
    finish();
    await removing;
    expect(existsSync(dir)).toBe(false);
    expect(root.accountCredentialMutations).toBe(0);
    expect(root.claudeCodeFlights.has(pending)).toBe(true); // Owner, not invalidation, cleans flights.
});

test("a rejected pending refresh and failed deletion still release the mutation counter", async () => {
    const { ctx, root, dir } = fixture();
    let fail!: () => void;
    const pending = new Promise<string | null>((_resolve, reject) => { fail = () => reject(new Error("fixture refresh failed")); });
    root.claudeCodeFlights.add(pending);
    ctx.fns.llm.accountCredentialPath = () => { throw new Error("fixture removal failed"); };
    const removing = removeAccount(ctx, null, { provider: "claude-code", account: "work" });
    await Promise.resolve(); await Promise.resolve();
    expect(root.accountCredentialMutations).toBe(1);
    fail();
    await expect(removing).rejects.toThrow("fixture removal failed");
    expect(root.accountCredentialMutations).toBe(0);
    expect(root.claudeCodeTokens).toBeUndefined();
    expect(existsSync(dir)).toBe(true);
});
