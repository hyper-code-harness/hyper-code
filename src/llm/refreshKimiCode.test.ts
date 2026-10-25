import { test, expect, afterEach, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import refresh from "./refreshKimiCode";
import resolve from "./resolveEndpoint";

const dirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
    const dir = mkdtempSync(`${tmpdir()}/kimi-refresh-`); dirs.push(dir);
    const file = `${dir}/credentials.json`;
    const put = (token = "expired", seconds = -100) => writeFileSync(file, JSON.stringify({ access_token: token, refresh_token: "test-refresh", expires_at: Date.now() / 1000 + seconds }));
    put();
    const ctx: any = { env: { HOME: dir }, fns: { llm: { accountCredentialPath: () => ({ file }) } } };
    ctx.fns.llm.refreshKimiCode = (opts: any) => refresh(ctx, null, opts);
    return { ctx, file, put };
}
const response = () => Response.json({ access_token: "new-access", refresh_token: "rotated", expires_in: 900 });
test("singleflight persists rotation; endpoint discovery uses refresh", async () => {
    const { ctx, file } = fixture(); let requests = 0;
    globalThis.fetch = (async () => { requests++; await Bun.sleep(10); return response(); }) as typeof fetch;
    const tokens = await Promise.all(Array.from({ length: 20 }, () => refresh(ctx, null, {})));
    expect(new Set(tokens)).toEqual(new Set(["new-access"])); expect(requests).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8")).refresh_token).toBe("rotated");
    expect((await resolve(ctx, null, { model: "kimi-coding:k3" })).apiKey).toBe("new-access");
});
test("rejection cooldown logs once without response secrets and rotated CLI file bypasses it", async () => {
    const { ctx, put } = fixture(); let requests = 0;
    const log = spyOn(console, "warn").mockImplementation(() => {});
    try {
        globalThis.fetch = (async () => { requests++; return Response.json({ error: "invalid_grant", error_description: "PRIVATE_TOKEN" }, { status: 400 }); }) as typeof fetch;
        expect(await refresh(ctx, null, {})).toBeNull(); expect(await refresh(ctx, null, {})).toBeNull();
        expect(requests).toBe(1); expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_TOKEN");
        put("cli-login", 900); expect(await refresh(ctx, null, {})).toBe("cli-login");
        put("cli-expired"); globalThis.fetch = (async () => { requests++; return response(); }) as typeof fetch;
        expect(await refresh(ctx, null, {})).toBe("new-access"); expect(requests).toBe(2);
    } finally { log.mockRestore(); }
});
test("transient failures preserve still-valid credentials and bound network with a signal", async () => {
    const { ctx, put } = fixture(); put("still-valid", 30); let signal: AbortSignal | null | undefined;
    const log = spyOn(console, "warn").mockImplementation(() => {});
    try {
        globalThis.fetch = (async (_url, init) => { signal = init?.signal; throw new Error("PRIVATE_TOKEN"); }) as typeof fetch;
        expect(await refresh(ctx, null, {})).toBe("still-valid"); expect(signal).toBeInstanceOf(AbortSignal);
        expect(await refresh(ctx, null, {})).toBe("still-valid"); expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_TOKEN");
    } finally { log.mockRestore(); }
});
test("separate credential paths refresh independently", async () => {
    const a = fixture(), b = fixture(); let requests = 0;
    globalThis.fetch = (async () => { requests++; return response(); }) as typeof fetch;
    await Promise.all([refresh(a.ctx, null, {}), refresh(b.ctx, null, {})]); expect(requests).toBe(2);
});
test("CLI rotation during refresh is not overwritten", async () => {
    const { ctx, put, file } = fixture();
    globalThis.fetch = (async () => { put("cli-wins", 900); return response(); }) as typeof fetch;
    expect(await refresh(ctx, null, {})).toBe("cli-wins");
    expect(JSON.parse(readFileSync(file, "utf8")).access_token).toBe("cli-wins");
});
