import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Load the stable 32-byte encryption key for managed OAuth and local secrets.
 *
 * Reuses the validated key for this process/configuration and shares concurrent
 * loads. Environment keys take precedence; macOS uses Login Keychain with an
 * asynchronous two-second command deadline, importing the legacy key file only
 * when no keychain item exists. An existing validated legacy file remains a
 * headless fallback when keychain access fails. New file keys are only created
 * after an explicit item-not-found result, never on a locked/failed read.
 * Failed loads use a 30-second retry cooldown to avoid keychain error storms.
 * Restart or clear oauthEncryptionKeyCache after
 * deliberately migrating an existing store to a different encryption key.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<Uint8Array> {
    const configured = ctx.env.HYPER_OAUTH_ENCRYPTION_KEY;
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    const service = ctx.env.HYPER_OAUTH_KEYCHAIN_SERVICE ?? "hyper-code2/local-secret-store";
    const account = ctx.env.USER ?? process.env.USER ?? "local";
    const path = ctx.env.HYPER_OAUTH_KEY_FILE ?? `${home}/.hyper-code2/oauth.key`;
    type KeyCache = { identity: string; key?: Uint8Array; pending?: Promise<Uint8Array>; retryAt?: number; failure?: string };
    const root = ((ctx.state as { llm?: { oauthEncryptionKeyCache?: KeyCache } }).llm ??= {});
    const identity = JSON.stringify([configured ? Bun.hash(configured).toString() : null, home, service, account, path, process.platform]);
    let cache = root.oauthEncryptionKeyCache;
    if (!cache || cache.identity !== identity) cache = root.oauthEncryptionKeyCache = { identity };
    if (cache.key) return cache.key.slice();
    if (cache.pending) return (await cache.pending).slice();
    if (cache.failure && (cache.retryAt ?? 0) > Date.now()) throw new Error(cache.failure);
    cache.pending = (async () => {
        if (configured) return decodeKey(configured);
        if (!home) throw new Error("OAuth encryption key is unavailable");
        if (process.platform === "darwin") {
            const existing = await security(["find-generic-password", "-s", service, "-a", account, "-w"]);
            if (existing.code === 0) return decodeKey(existing.text.trim());
            // Preserve the established headless file fallback, but never generate
            // a replacement key when the keychain might merely be locked.
            if (existing.code !== 44) {
                try { return decodeKey((await readFile(path, "utf8")).trim()); }
                catch { throw new Error("OAuth encryption keychain is unavailable and no valid fallback key exists"); }
            }
        }
        let encoded: string;
        let existingFile = true;
        try { encoded = (await readFile(path, "utf8")).trim(); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("OAuth encryption key file is unavailable");
            existingFile = false;
            encoded = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
        }
        const key = decodeKey(encoded);
        if (process.platform === "darwin") {
            // Do not -U overwrite: another process may have initialized first.
            const saved = await security(["add-generic-password", "-s", service, "-a", account, "-w", encoded]);
            if (saved.code === 0) return key;
            const winner = await security(["find-generic-password", "-s", service, "-a", account, "-w"]);
            if (winner.code === 0) return decodeKey(winner.text.trim());
            if (existingFile) return key;
            // Only create a new headless fallback if a second lookup confirms
            // no keychain item was created by this or another process.
            if (winner.code !== 44) throw new Error("OAuth encryption key could not be stored in keychain");
        }
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        try {
            await writeFile(path, encoded, { mode: 0o600, flag: "wx" });
            await chmod(path, 0o600);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("OAuth encryption key could not be stored");
        }
        // Another process may have won the exclusive file create.
        return decodeKey((await readFile(path, "utf8")).trim());
    })();
    try {
        cache.key = await cache.pending;
        delete cache.failure;
        delete cache.retryAt;
        return cache.key.slice();
    } catch (error) {
        // Every intentional error below is sanitized; filesystem errors can carry
        // paths, so only retain the public OAuth message across the cooldown.
        const message = error instanceof Error && error.message.startsWith("OAuth encryption key")
            ? error.message : "OAuth encryption key is unavailable";
        cache.failure = message;
        cache.retryAt = Date.now() + 30_000;
        throw new Error(message);
    } finally {
        delete cache.pending;
    }
}

async function security(args: string[]): Promise<{ code: number; text: string }> {
    try {
        const proc = Bun.spawn(["/usr/bin/security", ...args], {
            stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 2_000, killSignal: "SIGKILL",
        });
        const [code, text] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
        return { code, text };
    } catch {
        // Never expose command arguments or keychain output in an error.
        return { code: -1, text: "" };
    }
}

function decodeKey(value: string): Uint8Array {
    let bytes: Buffer;
    try { bytes = Buffer.from(value, value.includes("-") || value.includes("_") ? "base64url" : "base64"); }
    catch { throw new Error("OAuth encryption key is invalid"); }
    if (bytes.length !== 32) throw new Error("OAuth encryption key must decode to 32 bytes");
    return new Uint8Array(bytes);
}
