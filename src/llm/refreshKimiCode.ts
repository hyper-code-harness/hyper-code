import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
type Credentials = { access_token?: string; refresh_token?: string; expires_at?: number; [key: string]: unknown };
type Entry = { fingerprint: string; retryAt: number; failures: number; pending?: Promise<string | null> };
const entries = new Map<string, Entry>();

/**
 * Read or refresh one Kimi subscription credential file, sharing concurrent refreshes.
 * Re-reads CLI credentials on every call; changed credentials bypass failure cooldowns.
 * Rejected authorization is retried after five minutes; transient failures back off
 * from 30 seconds to five minutes. Network requests time out after ten seconds.
 * Returns null when no valid token is available; never logs credential or response bodies.
 * @param opts.account Credential slot; default uses the CLI file, named accounts use isolated Hyper files. @default "default"
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Credential slot to read and refresh independently. @default "default" */ account?: string;
}): Promise<string | null> {
    const account = String(opts?.account ?? "").trim() || "default";
    if (account === "default" && ctx.env.KIMI_CODING_API_KEY) return ctx.env.KIMI_CODING_API_KEY;
    const { file } = ctx.fns.llm.accountCredentialPath({ provider: "kimi-coding", account });
    if (!file) return null;
    const host = (ctx.env.KIMI_CODE_OAUTH_HOST ?? "https://auth.kimi.com").replace(/\/$/, "");
    const key = `${host}\n${file}`;
    // Read before consulting cooldowns: the CLI may have rotated tokens or logged in.
    const creds = readCredentials(file);
    if (!creds) return null;
    const fingerprint = createHash("sha256").update(JSON.stringify(creds)).digest("hex");
    let entry = entries.get(key);
    if (valid(creds, 60)) return creds.access_token!;
    if (entry?.pending) return entry.pending;
    if (!entry || entry.fingerprint !== fingerprint) {
        entry = { fingerprint, retryAt: 0, failures: 0 };
        entries.set(key, entry);
    }
    if (!creds.refresh_token || Date.now() < entry.retryAt) return valid(creds) ? creds.access_token! : null;
    const state = entry;
    const fail = (reason: string, rejected = false): string | null => {
        state.failures++;
        const delay = rejected ? 300_000 : Math.min(300_000, 30_000 * 2 ** Math.min(state.failures - 1, 4));
        state.retryAt = Date.now() + delay;
        console.warn(`[kimi-coding] refresh ${reason}; retry in ${delay / 1000}s${rejected ? "; login may be required" : ""}`);
        const latest = readCredentials(file);
        return latest && valid(latest) ? latest.access_token! : null;
    };
    state.pending = (async () => {
        try {
            const res = await fetch(`${host}/api/oauth/token`, {
                method: "POST",
                signal: AbortSignal.timeout(10_000),
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    "X-Msh-Platform": "hyper-code2",
                    "X-Msh-Version": "0.1",
                    "X-Msh-Device-Id": readDeviceId(ctx.env.HOME ?? process.env.HOME ?? ""),
                },
                body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: creds.refresh_token! }),
            });
            const data = await res.json().catch(() => ({})) as Credentials & { error?: string; expires_in?: number };
            if (!res.ok) return fail(`HTTP ${res.status}`, res.status === 401 || res.status === 403 || data.error === "invalid_grant");
            if (typeof data.access_token !== "string" || !data.access_token) return fail("invalid response");
            // Do not overwrite credentials rotated by the CLI during the request.
            const latest = readCredentials(file);
            if (!latest || createHash("sha256").update(JSON.stringify(latest)).digest("hex") !== fingerprint) {
                return latest && valid(latest) ? latest.access_token! : null;
            }
            const updated: Credentials = {
                ...creds,
                access_token: data.access_token,
                refresh_token: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : creds.refresh_token,
                expires_at: typeof data.expires_at === "number" ? data.expires_at : Date.now() / 1000 + (typeof data.expires_in === "number" ? data.expires_in : 900),
            };
            if (!valid(updated)) return fail("invalid token expiry");
            try { writeFileSync(file, JSON.stringify(updated, null, 2), { mode: 0o600 }); }
            catch { return fail("credential persistence failed"); }
            state.failures = 0;
            state.retryAt = 0;
            return updated.access_token!;
        } catch { return fail("network or response failure"); }
    })().finally(() => { state.pending = undefined; });
    return state.pending;
}

function readCredentials(path: string): Credentials | null {
    try { const value = JSON.parse(readFileSync(path, "utf8")); return value && typeof value === "object" ? value : null; }
    catch { return null; }
}

function valid(creds: Credentials, margin = 0): boolean {
    if (typeof creds.access_token !== "string" || !creds.access_token) return false;
    let exp = creds.expires_at;
    try {
        const payload = JSON.parse(Buffer.from(creds.access_token.split(".")[1] ?? "", "base64url").toString());
        if (typeof payload.exp === "number") exp = payload.exp;
    } catch { /* Opaque OAuth tokens use the stored expires_at. */ }
    return typeof exp === "number" && Number.isFinite(exp) && exp > Date.now() / 1000 + margin;
}

function readDeviceId(home: string): string {
    try { return readFileSync(`${home}/.kimi/device_id`, "utf8").trim(); }
    catch { return "hyper-code2"; }
}
