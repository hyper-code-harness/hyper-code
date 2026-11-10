import { readFileSync, writeFileSync } from "node:fs";
// Returns a currently-valid Claude Code subscription access_token.
// Reads the OAuth pair from the macOS keychain item `Claude Code-credentials`
// (the same one the official `claude` CLI uses), refreshes via Anthropic's
// OAuth token endpoint when within 60s of expiry, and writes the refreshed
// pair back so the CLI keeps working too.
// Token endpoint + client_id are settable via env so that if Anthropic
// changes them we can patch without a rebuild:
//   CLAUDE_CODE_OAUTH_TOKEN_URL  (default: https://console.anthropic.com/v1/oauth/token)
//   CLAUDE_CODE_CLIENT_ID        (default: 9d1c250a-e61b-44d9-88ed-5944d1962f5e)
// On non-macOS or when keychain access fails, returns null. Caller should
// surface a clear error rather than silently 401.
const DEFAULT_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const KEYCHAIN_ITEM = "Claude Code-credentials";

type Creds = {
    claudeAiOauth: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number; // ms since epoch
        scopes?: string[];
        subscriptionType?: string;
    };
};

/** Refreshes Claude Code credentials for one isolated CLI account. */
/**
 * Return a valid Claude Code subscription token for one account slot.
 * @param opts.account Credential slot; named slots use isolated keychain services.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Credential slot within Claude Code. @default "default" */ account?: string }): Promise<string | null> {
    const account = String(opts?.account ?? "").trim() || "default";
    if (account === "default" && ctx.env.CLAUDE_CODE_ACCESS_TOKEN) return ctx.env.CLAUDE_CODE_ACCESS_TOKEN;

    const user = ctx.env.USER ?? process.env.USER ?? "";
    if (!user) {
        console.warn("[claude-code] $USER unset — cannot read keychain");
        return null;
    }

    let creds: Creds;
    const location = ctx.fns.llm.accountCredentialPath({ provider: "claude-code", account });
    const service = location.keychainService!;
    // Off macOS the claude CLI keeps the same JSON in <config dir>/.credentials.json.
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    const file = process.platform === "darwin" ? null : `${location.dir ?? `${home}/.claude`}/.credentials.json`;
    try {
        const raw = file ? readCredFile(file) : readKeychain(user, service);
        if (!raw) return null;
        creds = JSON.parse(raw);
    } catch (e: any) {
        console.warn(`[claude-code] cannot read keychain: ${e?.message}`);
        return null;
    }

    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken || !oauth?.refreshToken) {
        console.warn("[claude-code] keychain entry missing accessToken/refreshToken");
        return null;
    }

    if (oauth.expiresAt - Date.now() > 60_000) return oauth.accessToken;

    // One refresh per account at a time: refresh tokens rotate, so a second
    // concurrent refresh would send the token the first one just invalidated.
    const inflight: Map<string, Promise<string | null>> = ((ctx.state as any).llm ??= {}).claudeCodeRefresh ??= new Map();
    const pending = inflight.get(service);
    if (pending) return pending;
    const p = refresh(ctx, user, service, creds, file).finally(() => inflight.delete(service));
    inflight.set(service, p);
    return p;
}

async function refresh(ctx: Context, user: string, service: string, creds: Creds, file: string | null): Promise<string | null> {
    const oauth = creds.claudeAiOauth;
    const now = Date.now();

    const tokenUrl = ctx.env.CLAUDE_CODE_OAUTH_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    const clientId = ctx.env.CLAUDE_CODE_CLIENT_ID ?? DEFAULT_CLIENT_ID;
    console.log(`[claude-code] access token expired ${Math.round((now - oauth.expiresAt) / 1000)}s ago — refreshing via ${tokenUrl}`);

    const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: oauth.refreshToken,
            client_id: clientId,
        }),
    });
    if (!res.ok) {
        console.warn(`[claude-code] refresh failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
        // The `claude` CLI shares this keychain item and may have rotated the
        // pair under us — adopt its token instead of failing the request.
        const current = readCreds(user, service, file);
        if (current && current.refreshToken !== oauth.refreshToken && current.expiresAt - Date.now() > 60_000) {
            console.log("[claude-code] using the pair another process refreshed");
            return current.accessToken;
        }
        return null;
    }
    const data: any = await res.json();
    const newAccess: string | undefined = data.access_token;
    const newRefresh: string = data.refresh_token ?? oauth.refreshToken;
    if (!newAccess) {
        console.warn(`[claude-code] refresh response missing access_token: ${JSON.stringify(data).slice(0, 200)}`);
        return null;
    }
    const expiresInMs = typeof data.expires_in === "number" ? data.expires_in * 1000 : 3600_000;
    const expiresAt = now + expiresInMs;

    try {
        const updated: Creds = {
            ...creds,
            claudeAiOauth: {
                ...oauth,
                accessToken: newAccess,
                refreshToken: newRefresh,
                expiresAt,
            },
        };
        if (file) writeFileSync(file, JSON.stringify(updated), { mode: 0o600 });
        else writeKeychain(user, service, JSON.stringify(updated));
    } catch (e: any) {
        console.warn(`[claude-code] could not write refreshed creds: ${e?.message}`);
    }
    console.log(`[claude-code] refreshed — new access expires at ${new Date(expiresAt).toISOString()}`);
    return newAccess;
}

function readCreds(user: string, service: string, file: string | null): Creds["claudeAiOauth"] | null {
    try {
        const raw = file ? readCredFile(file) : readKeychain(user, service);
        return raw ? (JSON.parse(raw) as Creds).claudeAiOauth ?? null : null;
    } catch {
        return null;
    }
}

function readCredFile(path: string): string | null {
    try { return readFileSync(path, "utf8").trim() || null; } catch { return null; }
}

function readKeychain(user: string, service: string): string | null {
    const proc = Bun.spawnSync({
        cmd: ["security", "find-generic-password", "-s", service, "-a", user, "-w"],
        stdout: "pipe",
        stderr: "pipe",
    });
    if (proc.exitCode !== 0) return null;
    return new TextDecoder().decode(proc.stdout).trimEnd();
}

function writeKeychain(user: string, service: string, value: string): void {
    // -U updates if the item exists; -s service, -a account, -w password.
    const proc = Bun.spawnSync({
        cmd: ["security", "add-generic-password", "-U", "-s", service, "-a", user, "-w", value],
        stdout: "pipe",
        stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
        const err = new TextDecoder().decode(proc.stderr).trim();
        throw new Error(`security add-generic-password failed: ${err}`);
    }
}
