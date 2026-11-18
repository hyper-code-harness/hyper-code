import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import key from "./oauthEncryptionKey";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const cleanup: Array<() => void> = [];
const encoded = Buffer.alloc(32, 7).toString("base64");
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); Object.defineProperty(process, "platform", platform); });
function fixture() {
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    const home = mkdtempSync(`${tmpdir()}/oauth-key-mock-`); cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    const ctx: any = { state: {}, env: { HOME: home, USER: "mock", HYPER_OAUTH_KEY_FILE: `${home}/key`, HYPER_OAUTH_KEYCHAIN_SERVICE: "mock-service" } };
    const spawn = spyOn(Bun, "spawn").mockImplementation((() => ({ exited: Promise.resolve(0), stdout: new Response(encoded).body })) as any);
    cleanup.push(() => spawn.mockRestore()); return { ctx, spawn, home };
}
test("one bounded asynchronous keychain read is shared, cached, and returned as independent bytes", async () => {
    const { ctx, spawn } = fixture();
    const values = await Promise.all(Array.from({ length: 20 }, () => key(ctx, null, {})));
    expect(spawn).toHaveBeenCalledTimes(1); expect(values.every((v) => v.length === 32 && v[0] === 7)).toBe(true);
    const opts = spawn.mock.calls[0]![1] as any;
    expect(opts.timeout).toBe(2_000); expect(opts.killSignal).toBe("SIGKILL"); expect(opts.stderr).toBe("ignore");
    values[0]![0] = 88; expect((await key(ctx, null, {}))[0]).toBe(7); expect(spawn).toHaveBeenCalledTimes(1);
});
test("configuration changes invalidate and explicit environment keys never invoke security", async () => {
    const { ctx, spawn } = fixture(); ctx.env.HYPER_OAUTH_ENCRYPTION_KEY = encoded;
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(spawn).not.toHaveBeenCalled();
    ctx.env.HYPER_OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect((await key(ctx, null, {}))[0]).toBe(8); delete ctx.env.HYPER_OAUTH_ENCRYPTION_KEY;
    await key(ctx, null, {}); expect(spawn).toHaveBeenCalledTimes(1);
    ctx.env.HYPER_OAUTH_KEYCHAIN_SERVICE = "another-test-service";
    await key(ctx, null, {}); expect(spawn).toHaveBeenCalledTimes(2);
});
test("timeout or locked keychain fails closed with a bounded thirty-second failure cooldown", async () => {
    const { ctx, spawn } = fixture(); let now = 1_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now); cleanup.push(() => clock.mockRestore());
    spawn.mockImplementation((() => ({ exited: Promise.resolve(137), stdout: new Response("private output").body })) as any);
    const failures = await Promise.allSettled(Array.from({ length: 20 }, () => key(ctx, null, {})));
    expect(failures.every((x) => x.status === "rejected")).toBe(true); expect(spawn).toHaveBeenCalledTimes(1);
    spawn.mockImplementation((() => ({ exited: Promise.resolve(0), stdout: new Response(encoded).body })) as any);
    now += 29_999;
    await expect(key(ctx, null, {})).rejects.toThrow("OAuth encryption keychain is unavailable"); expect(spawn).toHaveBeenCalledTimes(1);
    now++;
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(spawn).toHaveBeenCalledTimes(2);
});
test("changing configuration bypasses a prior failed-key cooldown", async () => {
    const { ctx, spawn } = fixture();
    spawn.mockImplementation((() => ({ exited: Promise.resolve(137), stdout: new Response("").body })) as any);
    await expect(key(ctx, null, {})).rejects.toThrow("unavailable");
    ctx.env.HYPER_OAUTH_ENCRYPTION_KEY = encoded;
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(spawn).toHaveBeenCalledTimes(1);
});
test("a missing key imports the legacy file once without -U overwrite and caches only a persisted key", async () => {
    const { ctx, spawn, home } = fixture(); writeFileSync(`${home}/key`, encoded);
    spawn.mockImplementation(((args: string[]) => ({ exited: Promise.resolve(args[1] === "find-generic-password" ? 44 : 0), stdout: new Response("").body })) as any);
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1]![0]).not.toContain("-U"); await key(ctx, null, {}); expect(spawn).toHaveBeenCalledTimes(2);
});
test("headless macOS keeps the existing file when keychain migration fails", async () => {
    const { ctx, spawn, home } = fixture(); writeFileSync(`${home}/key`, encoded);
    spawn.mockImplementation(((args: string[]) => ({ exited: Promise.resolve(args[1] === "find-generic-password" ? 44 : 1), stdout: new Response("").body })) as any);
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(readFileSync(`${home}/key`, "utf8")).toBe(encoded);
    expect(spawn).toHaveBeenCalledTimes(3); await key(ctx, null, {}); expect(spawn).toHaveBeenCalledTimes(3);
});
test("locked keychain or spawn error can use an existing validated file without writes", async () => {
    const { ctx, spawn, home } = fixture(); writeFileSync(`${home}/key`, encoded);
    spawn.mockImplementation((() => ({ exited: Promise.resolve(137), stdout: new Response("").body })) as any);
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(spawn).toHaveBeenCalledTimes(1);
    delete ctx.state.llm.oauthEncryptionKeyCache;
    spawn.mockImplementation((() => { throw new Error("mock spawn failure"); }) as any);
    expect((await key(ctx, null, {}))[0]).toBe(7); expect(readFileSync(`${home}/key`, "utf8")).toBe(encoded);
});
test("locked keychain without an existing fallback never creates a replacement file", async () => {
    const { ctx, spawn, home } = fixture();
    spawn.mockImplementation((() => ({ exited: Promise.resolve(137), stdout: new Response("").body })) as any);
    await expect(key(ctx, null, {})).rejects.toThrow("unavailable");
    expect(existsSync(`${home}/key`)).toBe(false); expect(spawn).toHaveBeenCalledTimes(1);
});
test("headless first use creates fallback only after repeated item-not-found and persists it", async () => {
    const { ctx, spawn, home } = fixture();
    spawn.mockImplementation(((args: string[]) => ({ exited: Promise.resolve(args[1] === "find-generic-password" ? 44 : 1), stdout: new Response("").body })) as any);
    const result = await key(ctx, null, {});
    expect(result.length).toBe(32); expect(Buffer.from(readFileSync(`${home}/key`, "utf8"), "base64url")).toEqual(Buffer.from(result));
    expect(spawn).toHaveBeenCalledTimes(3);
});
test("non-macOS file creates are singleflight and persisted; invalid env keys do not poison cache", async () => {
    const { ctx, spawn } = fixture(); Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    const results = await Promise.all([key(ctx, null, {}), key(ctx, null, {})]);
    expect(results[0]).toEqual(results[1]); delete ctx.state.llm.oauthEncryptionKeyCache;
    expect(await key(ctx, null, {})).toEqual(results[0]); expect(spawn).not.toHaveBeenCalled();
    ctx.env.HYPER_OAUTH_ENCRYPTION_KEY = "invalid"; await expect(key(ctx, null, {})).rejects.toThrow("32 bytes");
    ctx.env.HYPER_OAUTH_ENCRYPTION_KEY = encoded; expect((await key(ctx, null, {}))[0]).toBe(7);
});
