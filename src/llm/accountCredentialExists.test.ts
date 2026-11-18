import { afterEach, expect, spyOn, test } from "bun:test";
import exists from "./accountCredentialExists";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); Object.defineProperty(process, "platform", platform); });
function fixture() {
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    let now = 1_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now); restores.push(() => clock.mockRestore());
    const ctx: any = { state: {}, env: { USER: "mock-user", HOME: "/nonexistent-test-home" }, fns: { llm: {
        accountCredentialPath: ({ account = "default" }: { account?: string }) => ({ account, keychainService: `mock-service-${account}`, file: null, dir: null }),
    } } };
    return { ctx, advance: (ms: number) => { now += ms; } };
}
function spawnResult(exited: Promise<number>) {
    const spy = spyOn(Bun, "spawn").mockImplementation((() => ({ exited })) as any);
    restores.push(() => spy.mockRestore()); return spy;
}
test("concurrent presence probes share one asynchronous bounded keychain call without reading secrets", async () => {
    const { ctx } = fixture(); let finish!: (n: number) => void;
    const spawn = spawnResult(new Promise((resolve) => { finish = resolve; }));
    const pending = Array.from({ length: 20 }, () => exists(ctx, null, { provider: "claude-code" }));
    expect(spawn).toHaveBeenCalledTimes(1);
    const options = spawn.mock.calls[0]![0] as any;
    expect(options.cmd).not.toContain("-w"); expect(options.stdout).toBe("ignore"); expect(options.stderr).toBe("ignore");
    expect(options.timeout).toBe(2_000); expect(options.killSignal).toBe("SIGKILL");
    finish(0); expect(await Promise.all(pending)).toEqual(Array(20).fill(true));
});
test("positive five-minute TTL, negative ten-second TTL, forced refresh and account isolation", async () => {
    const { ctx, advance } = fixture(); const spawn = spawnResult(Promise.resolve(0));
    expect(await exists(ctx, null, { provider: "claude-code" })).toBe(true);
    advance(299_999); await exists(ctx, null, { provider: "claude-code" }); expect(spawn).toHaveBeenCalledTimes(1);
    advance(1); await exists(ctx, null, { provider: "claude-code" }); expect(spawn).toHaveBeenCalledTimes(2);
    await exists(ctx, null, { provider: "claude-code", account: "work" }); expect(spawn).toHaveBeenCalledTimes(3);
    spawn.mockImplementation((() => ({ exited: Promise.resolve(44) })) as any);
    expect(await exists(ctx, null, { provider: "claude-code", force: true })).toBe(false);
    advance(9_999); expect(await exists(ctx, null, { provider: "claude-code" })).toBe(false); expect(spawn).toHaveBeenCalledTimes(4);
    spawn.mockImplementation((() => ({ exited: Promise.resolve(0) })) as any);
    advance(1); expect(await exists(ctx, null, { provider: "claude-code" })).toBe(true); expect(spawn).toHaveBeenCalledTimes(5);
});
test("deleted map cannot be repopulated by old in-flight probes; spawn errors are temporary negatives", async () => {
    const { ctx, advance } = fixture(); let finish!: (n: number) => void;
    const spawn = spawnResult(new Promise((resolve) => { finish = resolve; }));
    const old = exists(ctx, null, { provider: "claude-code" });
    delete ctx.state.llm.accountCredentialCache;
    spawn.mockImplementation((() => { throw new Error("mock unavailable"); }) as any);
    expect(await exists(ctx, null, { provider: "claude-code" })).toBe(false);
    finish(0); expect(await old).toBe(true);
    expect(await exists(ctx, null, { provider: "claude-code" })).toBe(false);
    advance(10_000); spawn.mockImplementation((() => ({ exited: Promise.resolve(0) })) as any);
    expect(await exists(ctx, null, { provider: "claude-code" })).toBe(true);
});
