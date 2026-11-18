import { existsSync } from "node:fs";

/**
 * Check a subscription credential's presence without reading or returning its secret.
 *
 * macOS Keychain probes are asynchronous, killed after two seconds, and shared
 * by concurrent callers. Positive results last five minutes; negative results
 * last ten seconds. File-backed credentials use the same bounded cache. Login
 * and removal must delete ctx.state.llm.accountCredentialCache; deleting the
 * whole map also prevents an earlier in-flight probe from restoring stale data.
 * Use force after a completed CLI login to bypass an earlier cached result.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Subscription provider whose credential store to inspect. */ provider: "codex" | "claude-code" | "kimi-coding";
    /** Named credential slot; omitted means the provider's default login. @default "default" */ account?: string;
    /** Recheck the credential store instead of using a completed cached probe. @default false */ force?: boolean;
}): Promise<boolean> {
    const location = ctx.fns.llm.accountCredentialPath({ provider: opts.provider, account: opts.account });
    const user = ctx.env.USER ?? process.env.USER ?? "";
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    const file = location.file ?? (process.platform !== "darwin" && location.keychainService
        ? `${location.dir ?? `${home}/.claude`}/.credentials.json` : null);
    const key = JSON.stringify([opts.provider, location.account, file, location.keychainService, user]);
    type Probe = { value?: boolean; expiresAt: number; pending?: Promise<boolean> };
    const root = ((ctx.state as { llm?: { accountCredentialCache?: Map<string, Probe> } }).llm ??= {});
    const cache = (root.accountCredentialCache ??= new Map());
    const known = cache.get(key);
    if (known?.pending) return known.pending;
    if (!opts.force && known?.value !== undefined && known.expiresAt > Date.now()) return known.value;
    // Evict old entries lazily so removed account slots do not accumulate forever.
    for (const [id, probe] of cache) if (!probe.pending && probe.expiresAt <= Date.now()) cache.delete(id);
    const probe: Probe = { expiresAt: 0 };
    cache.set(key, probe);
    probe.pending = (async () => {
        let value = false;
        try {
            if (file) value = existsSync(file);
            else if (location.keychainService && user) {
                // Never pass -w: neither the token nor keychain metadata is captured.
                const proc = Bun.spawn({
                    cmd: ["/usr/bin/security", "find-generic-password", "-s", location.keychainService, "-a", user],
                    stdin: "ignore", stdout: "ignore", stderr: "ignore",
                    timeout: 2_000, killSignal: "SIGKILL",
                });
                value = await proc.exited === 0;
            }
        } catch {
            // A missing/locked keychain is unavailable, not a permanent negative.
            value = false;
        }
        probe.value = value;
        probe.expiresAt = Date.now() + (value ? 300_000 : 10_000);
        return value;
    })();
    try { return await probe.pending; }
    finally { delete probe.pending; }
}
