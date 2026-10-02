import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

async function opSecret(ctx: Context, ref: string) {
    const name = ref.includes("session.txt") ? "session" : ref.includes("config.json") ? "config" : new Bun.CryptoHasher("sha256").update(ref).digest("hex").slice(0, 32);
    const value = await ctx.fns.secrets.get({ ref, namespace: "telegram", name });
    if (!value) throw new Error("Telegram credential is not configured");
    return value;
}

type TelegramClientSingleton = { client?: TelegramClient; connecting?: Promise<TelegramClient> | null };
const telegramClientKey = Symbol.for("hyper-code2.telegram.client.singleton");

async function connected(ctx: Context) {
    const root = globalThis as typeof globalThis & { [telegramClientKey]?: TelegramClientSingleton };
    const cache = (root[telegramClientKey] ??= {});
    // Adopt a pre-singleton client once during hot reload instead of opening the
    // same persisted StringSession a second time in this process.
    const legacy = (ctx.state as any).telegram;
    if (!cache.client?.connected && legacy?.client?.connected) cache.client = legacy.client;
    if (cache.client?.connected) return cache.client;
    if (cache.connecting) return await cache.connecting;
    cache.connecting = (async () => {
        const [configRaw, sessionString] = await Promise.all([
            opSecret(ctx, "op://hyper/telegram config.json/value"),
            opSecret(ctx, "op://hyper/telegram session.txt/value"),
        ]);
        if (!configRaw || !sessionString) throw new Error("Telegram credentials are not configured in 1Password");
        const config = JSON.parse(configRaw);
        const client = new TelegramClient(new StringSession(sessionString.trim()), config.apiId, String(config.apiHash), { connectionRetries: 5 });
        await client.connect();
        if (!(await client.checkAuthorization())) throw new Error("Telegram session is no longer authorized");
        cache.client = client;
        return client;
    })();
    try { return await cache.connecting; } finally { cache.connecting = null; }
}

/**
 * WRITE: send a file to a chat — as a document, or as an inline photo with asPhoto: true. ctx.fns.telegram.sendFile({ chat, path, caption?, asPhoto? })
 *   chat: chat id (string/number) or @username; path: local file path.
 * → { id, date }
 */
/**
 * Sends a file to a Telegram chat after write confirmation.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Operation options.
 * @returns The operation result.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Chat identifier or username. */
        chat: string | number;
        /** Local file path or API path, depending on the operation. */
        path: string;
        /** Optional file caption. */
        caption?: string;
        /** Send an image as a Telegram photo (inline preview) instead of a document attachment.
         * @default false */
        asPhoto?: boolean;
        /** Whether the caller confirmed the write operation. */
        confirm?: boolean;
    }) {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("sendFile: opts.chat required");
    if (!opts?.path) throw new Error("sendFile: opts.path required");
    if (opts.confirm !== true) throw new Error("telegram.sendFile is a real write; repeat with confirm: true after explicit user approval");
    const client = await connected(ctx);
    const result: any = await client.sendFile(String(opts.chat), {
        file: opts.path,
        caption: opts.caption || "",
        forceDocument: !opts.asPhoto,
    });
    return { id: result.id, date: new Date(result.date * 1000).toISOString() };
}
