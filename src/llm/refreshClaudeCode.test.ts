import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

let c: any;
let clock: number;
let stored: Map<string, string>;
let reads: number;
let writes: number;
let fetches: number;
let spawn: ReturnType<typeof spyOn>;
let date: ReturnType<typeof spyOn>;
let warn: ReturnType<typeof spyOn>;
let fetchSpy: ReturnType<typeof spyOn>;
let onRead: (() => Promise<void>) | undefined;
let onFetch: () => Promise<Response>;
const credential = (token = "access-a", expiresAt = clock + 60_000, refresh = "refresh-a") => JSON.stringify({ extra: "preserve", claudeAiOauth: { accessToken: token, expiresAt, refreshToken: refresh } });
const refreshResponse = () => Response.json({ access_token: "access-b", refresh_token: "refresh-b", expires_in: 3600 });
const call = (opts: { account?: string; rejectedToken?: string } = {}) => c.fns.llm.refreshClaudeCode(opts);

beforeAll(async () => { c = await mkTestCtx({ db: false, env: { USER: "fixture-user", HOME: "/nonexistent-hyper-keychain-test" } }); });
beforeEach(() => {
    c.state.llm = {};
    delete c.env.CLAUDE_CODE_ACCESS_TOKEN;
    clock = 1_800_000_000_000;
    reads = writes = fetches = 0;
    stored = new Map([["Claude Code-credentials", credential()]]);
    onRead = undefined;
    onFetch = async () => refreshResponse();
    date = spyOn(Date, "now").mockImplementation(() => clock);
    warn = spyOn(console, "warn").mockImplementation(() => {});
    spawn = spyOn(Bun, "spawn").mockImplementation(((opts: { cmd: string[]; timeout?: number; killSignal?: string }) => {
        expect(opts.cmd[0]).toBe("/usr/bin/security");
        expect(opts.timeout).toBe(5000);
        expect(opts.killSignal).toBe("SIGKILL");
        const service = opts.cmd[opts.cmd.indexOf("-s") + 1];
        if (opts.cmd[1] === "add-generic-password") {
            writes++;
            stored.set(service, opts.cmd[opts.cmd.indexOf("-w") + 1]);
            return { exited: Promise.resolve(0) };
        }
        reads++;
        const value = stored.get(service);
        const exited = onRead ? onRead().then(() => value ? 0 : 44) : Promise.resolve(value ? 0 : 44);
        return { stdout: new Blob([value ?? ""]).stream(), exited };
    }) as any);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_url: unknown, init: RequestInit) => {
        fetches++;
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return onFetch();
    }) as any);
});
afterEach(() => { spawn.mockRestore(); date.mockRestore(); warn.mockRestore(); fetchSpy.mockRestore(); });

// The real macOS boundary is mocked; these tests never access the real Keychain.
describe.skipIf(process.platform !== "darwin")("Claude Code memory credential cache", () => {
    test("100 concurrent cold callers and warm requests share one asynchronous read until exact expiry", async () => {
        expect(new Set(await Promise.all(Array.from({ length: 100 }, () => call())))).toEqual(new Set(["access-a"]));
        expect(reads).toBe(1);
        clock += 59_999;
        expect(await call()).toBe("access-a");
        expect(reads).toBe(1);
        clock++;
        stored.set("Claude Code-credentials", credential("external-login"));
        expect(await call()).toBe("external-login");
        expect(reads).toBe(2);
        expect(fetches).toBe(0);
    });
    test("expiry refresh and persistence are singleflight and the new token is cached", async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        expect(new Set(await Promise.all(Array.from({ length: 40 }, () => call())))).toEqual(new Set(["access-b"]));
        expect(fetches).toBe(1); expect(reads).toBe(2); expect(writes).toBe(1);
        expect(JSON.parse(stored.get("Claude Code-credentials")!).extra).toBe("preserve");
        expect(JSON.parse(stored.get("Claude Code-credentials")!).claudeAiOauth.refreshToken).toBe("refresh-b");
        expect(await call()).toBe("access-b"); expect(reads).toBe(2);
    });
    test("401 adopts external login; late 401 never invalidates the replacement", async () => {
        await call();
        stored.set("Claude Code-credentials", credential("external-login"));
        expect(new Set(await Promise.all(Array.from({ length: 40 }, () => call({ rejectedToken: "access-a" }))))).toEqual(new Set(["external-login"]));
        expect(reads).toBe(2); expect(fetches).toBe(0);
        expect(await call({ rejectedToken: "access-a" })).toBe("external-login");
        expect(reads).toBe(2);
    });
    test("401 refreshes the same rejected but unexpired token only once", async () => {
        await call();
        expect(new Set(await Promise.all(Array.from({ length: 40 }, () => call({ rejectedToken: "access-a" }))))).toEqual(new Set(["access-b"]));
        expect(fetches).toBe(1); expect(writes).toBe(1); expect(reads).toBe(3);
        expect(await call({ rejectedToken: "access-a" })).toBe("access-b");
        expect(fetches).toBe(1);
    });
    test("401 arriving during a cold read prevents handing out the rejected token", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        onRead = () => gate;
        const cold = call();
        const rejected = call({ rejectedToken: "access-a" });
        release();
        expect(await cold).toBe("access-b");
        expect(await rejected).toBe("access-b");
        expect(fetches).toBe(1);
    });
    test("missing, malformed, and denied credentials are negatively cached then recover", async () => {
        for (const value of [null, "PRIVATE malformed", JSON.stringify({ claudeAiOauth: { accessToken: 42 } })]) {
            c.state.llm = {}; reads = 0;
            if (value) stored.set("Claude Code-credentials", value); else stored.delete("Claude Code-credentials");
            expect(await call()).toBeNull();
            expect(await call()).toBeNull(); expect(reads).toBe(1);
            clock += 30_000;
            stored.set("Claude Code-credentials", credential("recovered"));
            expect(await call()).toBe("recovered"); expect(reads).toBe(2);
        }
        expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE");
    });
    test("failed refresh backs off, never logs body secrets or returns a rejected token", async () => {
        await call();
        onFetch = async () => Response.json({ error: "PRIVATE secret" }, { status: 400 });
        expect(await call({ rejectedToken: "access-a" })).toBeNull();
        const afterFailure = reads;
        expect(await call()).toBeNull();
        expect(await call({ rejectedToken: "access-a" })).toBeNull();
        expect(fetches).toBe(1); expect(reads).toBe(afterFailure);
        expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE");
        clock += 30_000;
        stored.set("Claude Code-credentials", credential("login-c"));
        expect(await call()).toBe("login-c");
    });
    test("late 401 for an older token cannot un-reject the newer token after cooldown", async () => {
        await call();
        expect(await call({ rejectedToken: "access-a" })).toBe("access-b");
        onFetch = async () => Response.json({}, { status: 400 });
        expect(await call({ rejectedToken: "access-b" })).toBeNull();
        clock += 30_000;
        onFetch = async () => Response.json({ access_token: "access-c", refresh_token: "refresh-c", expires_in: 3600 });
        expect(await call({ rejectedToken: "access-a" })).toBe("access-c");
        expect(fetches).toBe(3);
    });
    test("network and spawn errors have bounded retry without secret logging", async () => {
        spawn.mockImplementationOnce(() => { throw new Error("PRIVATE command args"); });
        expect(await call()).toBeNull(); expect(await call()).toBeNull();
        c.state.llm = {};
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        onFetch = async () => { throw new Error("PRIVATE token response"); };
        expect(await call()).toBeNull(); expect(await call()).toBeNull(); expect(fetches).toBe(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE");
    });
    test("external CLI rotation during HTTP refresh wins over our result", async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        onFetch = async () => { stored.set("Claude Code-credentials", credential("external", clock + 60_000, "rotated")); return refreshResponse(); };
        expect(await call()).toBe("external"); expect(writes).toBe(0);
        expect(await call()).toBe("external"); expect(reads).toBe(2);
    });
    test("write failure retains refreshed token in memory, not the expired stored value", async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        const defaultImpl = spawn.getMockImplementation()!;
        spawn.mockImplementation(((opts: { cmd: string[] }) => opts.cmd[1] === "add-generic-password" ? { exited: Promise.resolve(1) } : defaultImpl(opts)) as any);
        expect(await call()).toBe("access-b"); expect(await call()).toBe("access-b");
        expect(fetches).toBe(1); expect(reads).toBe(2);
    });
    for (const trigger of ["expiry", "401"]) test(`write failure preserves rotated refresh credentials through next ${trigger}`, async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        const defaultImpl = spawn.getMockImplementation()!;
        spawn.mockImplementation(((opts: { cmd: string[] }) => opts.cmd[1] === "add-generic-password" ? { exited: Promise.resolve(1) } : defaultImpl(opts)) as any);
        expect(await call()).toBe("access-b");
        if (trigger === "expiry") clock += 3_600_000;
        onFetch = async () => Response.json({ access_token: "access-c", refresh_token: "refresh-c", expires_in: 3600 });
        expect(await call(trigger === "401" ? { rejectedToken: "access-b" } : {})).toBe("access-c");
        const sent = JSON.parse((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body as string);
        expect(sent.refresh_token).toBe("refresh-b");
        expect(fetches).toBe(2);
    });
    test("failed post-refresh recheck retains the rotated candidate without writing blindly", async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        const defaultImpl = spawn.getMockImplementation()!;
        let denied = false;
        spawn.mockImplementation(((opts: { cmd: string[] }) => denied && opts.cmd[1] === "find-generic-password"
            ? { exited: Promise.resolve(137), stdout: new Response("").body }
            : defaultImpl(opts)) as any);
        onFetch = async () => { denied = true; return refreshResponse(); };
        expect(await call()).toBe("access-b"); expect(writes).toBe(0);
        denied = false; clock += 3_600_000;
        onFetch = async () => Response.json({ access_token: "access-c", refresh_token: "refresh-c", expires_in: 3600 });
        expect(await call()).toBe("access-c");
        const sent = JSON.parse((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body as string);
        expect(sent.refresh_token).toBe("refresh-b");
    });
    test("external deletion during refresh is not resurrected by a late write", async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        onFetch = async () => { stored.delete("Claude Code-credentials"); return refreshResponse(); };
        expect(await call()).toBeNull(); expect(writes).toBe(0);
    });
    test("login invalidation fences an old in-flight refresh without restoring its cache", async () => {
        stored.set("Claude Code-credentials", credential("expired", clock - 1));
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        onFetch = async () => { entered(); await gate; return refreshResponse(); };
        const pending = call(); await started;
        c.state.llm.accountCredentialRevision = 1;
        delete c.state.llm.claudeCodeTokens;
        stored.set("Claude Code-credentials", credential("new-login"));
        release();
        expect(await pending).toBeNull(); expect(writes).toBe(0);
        expect(await call()).toBe("new-login");
    });
    test("account removal blocks new refresh flights during its drain", async () => {
        c.state.llm.accountCredentialMutations = 1;
        expect(await call()).toBeNull(); expect(reads).toBe(0); expect(fetches).toBe(0);
        c.state.llm.accountCredentialMutations = 0;
        expect(await call()).toBe("access-a"); expect(reads).toBe(1);
    });
    test("distinct slots do not share tokens and explicit environment credentials bypass storage", async () => {
        const location = c.fns.llm.accountCredentialPath({ provider: "claude-code", account: "work" });
        stored.set(location.keychainService, credential("work-token"));
        expect(await call()).toBe("access-a");
        expect(await call({ account: "work" })).toBe("work-token"); expect(reads).toBe(2);
        c.env.CLAUDE_CODE_ACCESS_TOKEN = "env-token";
        expect(await call()).toBe("env-token"); expect(reads).toBe(2);
        expect(await call({ rejectedToken: "env-token" })).toBeNull();
        expect(fetches).toBe(0);
    });
});
