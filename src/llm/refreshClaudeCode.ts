import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const RETRY_MS = 30_000;

type OAuth = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    subscriptionType?: string;
};
type Creds = { claudeAiOauth: OAuth; [key: string]: unknown };
type Entry = { oauth?: OAuth; unpersistedFrom?: string; retryAt: number; rejectedToken?: string; pending?: Promise<string | null> };
type State = { claudeCodeTokens?: Map<string, Entry>; claudeCodeFlights?: Set<Promise<string | null>>; accountCredentialRevision?: number; accountCredentialMutations?: number };

/**
 * Return a Claude Code token cached in memory until expiry, or replace a token rejected by HTTP 401.
 *
 * Use immediately before local or relayed subscription requests. Concurrent callers share one
 * bounded asynchronous credential read/refresh per account; failures back off for 30 seconds.
 * Credentials are reread only on a cold cache, expiry, explicit login/logout invalidation or 401.
 * Named accounts use their isolated CLI location. An external CLI rotation is adopted on reread.
 * No token, Keychain output or OAuth response body is logged. Environment tokens are not refreshed.
 * @param opts.account Credential slot within Claude Code; named slots have separate caches. @default "default"
 * @param opts.rejectedToken Exact access token from a failed HTTP 401; a late failure cannot invalidate a newer token.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Credential slot within Claude Code; named slots have separate caches. @default "default" */
    account?: string;
    /** Exact bearer token rejected by HTTP 401. Omit for ordinary expiry-based lookup. */
    rejectedToken?: string;
} = {}): Promise<string | null> {
    const account = String(opts.account ?? "").trim() || "default";
    const override = account === "default" ? ctx.env.CLAUDE_CODE_ACCESS_TOKEN : undefined;
    if (override) return override === opts.rejectedToken ? null : override;
    const user = ctx.env.USER ?? process.env.USER ?? "";
    if (process.platform === "darwin" && !user) return null;
    const location = ctx.fns.llm.accountCredentialPath({ provider: "claude-code", account });
    const service = location.keychainService!;
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    const file = process.platform === "darwin" ? null : `${location.dir ?? `${home}/.claude`}/.credentials.json`;
    const root = ((ctx.state as typeof ctx.state & { llm?: State }).llm ??= {}) as State;
    if ((root.accountCredentialMutations ?? 0) > 0) return null;
    const cache = root.claudeCodeTokens ??= new Map();
    const key = JSON.stringify([user, service, file]);
    const revision = root.accountCredentialRevision ?? 0;
    let entry = cache.get(key);
    if (!entry) { entry = { retryAt: 0 }; cache.set(key, entry); }
    const current = entry;
    // A rejection arriving during a cold read must fence that read as well.
    if (opts.rejectedToken && (!current.oauth || current.oauth.accessToken === opts.rejectedToken)) {
        current.rejectedToken = opts.rejectedToken;
    }
    // Waiters must join before I/O, not just before the HTTP refresh.
    if (current.pending) return current.pending;
    if (usable(current.oauth, current.rejectedToken) && current.oauth!.accessToken !== opts.rejectedToken) {
        return current.oauth!.accessToken;
    }
    if (current.retryAt > Date.now()) return null;
    const stillCurrent = () => root.claudeCodeTokens === cache && (root.accountCredentialRevision ?? 0) === revision;
    const run = async (): Promise<string | null> => {
        try {
            const stored = await readCreds(user, service, file);
            if (!stored || !stillCurrent()) return null;
            const storedFingerprint = fingerprint(stored.claudeAiOauth);
            // A failed write must not lose the only usable rotated refresh token.
            // Adopt external changes instead; a deleted store never resurrects from memory.
            const keepUnpersisted = current.oauth && current.unpersistedFrom === storedFingerprint;
            const creds = keepUnpersisted ? { ...stored, claudeAiOauth: current.oauth! } : stored;
            let oauth = creds.claudeAiOauth;
            let unpersistedFrom = keepUnpersisted ? current.unpersistedFrom : undefined;
            if (!usable(oauth, current.rejectedToken)) {
                const refreshed = await refresh(ctx, user, service, file, creds, storedFingerprint, current.rejectedToken, stillCurrent);
                if (!refreshed) return null;
                oauth = refreshed.oauth;
                unpersistedFrom = refreshed.unpersistedFrom;
            }
            if (!stillCurrent() || !usable(oauth, current.rejectedToken)) return null;
            current.oauth = oauth;
            current.unpersistedFrom = unpersistedFrom;
            current.rejectedToken = undefined;
            current.retryAt = 0;
            return oauth.accessToken;
        } catch {
            // Error text can include subprocess arguments or OAuth secrets.
            console.warn("[claude-code] credential read or refresh failed; retrying after cooldown");
            return null;
        }
    };
    const flights = root.claudeCodeFlights ??= new Set();
    const pending = run().then(token => {
        if (!token) current.retryAt = Date.now() + RETRY_MS;
        return token;
    }).finally(() => {
        if (current.pending === pending) current.pending = undefined;
        flights.delete(pending);
    });
    current.pending = pending;
    flights.add(pending);
    return pending;
}

function usable(oauth: OAuth | undefined, rejected?: string): oauth is OAuth {
    return !!oauth?.accessToken && oauth.accessToken !== rejected && Number.isFinite(oauth.expiresAt) && oauth.expiresAt > Date.now();
}

function fingerprint(oauth: OAuth): string {
    return JSON.stringify([oauth.accessToken, oauth.refreshToken, oauth.expiresAt]);
}

async function refresh(ctx: Context, user: string, service: string, file: string | null, creds: Creds, storedFingerprint: string, rejected: string | undefined, stillCurrent: () => boolean): Promise<{ oauth: OAuth; unpersistedFrom?: string } | null> {
    const oauth = creds.claudeAiOauth;
    if (!oauth.refreshToken) return null;
    const now = Date.now();
    const response = await fetch(ctx.env.CLAUDE_CODE_OAUTH_TOKEN_URL ?? DEFAULT_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: oauth.refreshToken, client_id: ctx.env.CLAUDE_CODE_CLIENT_ID ?? DEFAULT_CLIENT_ID }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
        await response.body?.cancel();
        // The official CLI may have rotated the shared credentials meanwhile.
        const external = await readCreds(user, service, file);
        if (external && usable(external.claudeAiOauth, rejected) && fingerprint(external.claudeAiOauth) !== storedFingerprint) return { oauth: external.claudeAiOauth };
        console.warn(`[claude-code] OAuth refresh returned HTTP ${response.status}; retrying after cooldown`);
        return null;
    }
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    const seconds = data.expires_in ?? 3600;
    if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(seconds) || seconds <= 0) return null;
    const updated: Creds = { ...creds, claudeAiOauth: {
        ...oauth, accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : oauth.refreshToken,
        expiresAt: now + seconds * 1000,
    } };
    if (!stillCurrent()) return null;
    let external: Creds | null;
    try { external = await readCreds(user, service, file); }
    catch {
        // The provider already rotated the refresh token. Retain the candidate
        // without writing over a store we could not recheck.
        return stillCurrent() ? { oauth: updated.claudeAiOauth, unpersistedFrom: storedFingerprint } : null;
    }
    if (!stillCurrent()) return null;
    if (!external) return null;
    if (fingerprint(external.claudeAiOauth) !== storedFingerprint) {
        // Never overwrite a pair that another process rotated while the request ran.
        return usable(external.claudeAiOauth, rejected) ? { oauth: external.claudeAiOauth } : null;
    }
    if (!usable(updated.claudeAiOauth, rejected)) return null;
    try {
        if (file) await writeFile(file, JSON.stringify(updated), { mode: 0o600 });
        else await writeKeychain(user, service, JSON.stringify(updated));
    } catch {
        // Keep the rotated pair in memory even if persistence is temporarily unavailable.
        console.warn("[claude-code] could not persist refreshed credentials; keeping them in memory");
        return { oauth: updated.claudeAiOauth, unpersistedFrom: storedFingerprint };
    }
    return { oauth: updated.claudeAiOauth };
}

async function readCreds(user: string, service: string, file: string | null): Promise<Creds | null> {
    let raw: string | null;
    if (file) {
        try { raw = await readFile(file, "utf8"); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw new Error("Credential file unavailable");
        }
    } else {
        const proc = Bun.spawn({ cmd: ["/usr/bin/security", "find-generic-password", "-s", service, "-a", user, "-w"], stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5_000, killSignal: "SIGKILL" });
        const [output, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        if (exit === 44) return null;
        if (exit !== 0) throw new Error("Keychain unavailable");
        raw = output;
    }
    if (!raw) throw new Error("Credential store is empty");
    const creds = JSON.parse(raw) as Creds;
    const oauth = creds?.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || !oauth.accessToken || typeof oauth.expiresAt !== "number") throw new Error("Invalid credential store");
    return creds;
}

async function writeKeychain(user: string, service: string, value: string): Promise<void> {
    const proc = Bun.spawn({ cmd: ["/usr/bin/security", "add-generic-password", "-U", "-s", service, "-a", user, "-w", value], stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 5_000, killSignal: "SIGKILL" });
    if (await proc.exited !== 0) throw new Error("Keychain update failed");
}
