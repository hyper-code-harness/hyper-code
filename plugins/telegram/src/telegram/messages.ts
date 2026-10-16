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
        if (!Number.isInteger(config.apiId) || !config.apiHash) throw new Error("Telegram MTProto config is invalid");
        const client = new TelegramClient(new StringSession(sessionString.trim()), config.apiId, String(config.apiHash), { connectionRetries: 5 });
        await client.connect();
        if (!(await client.checkAuthorization())) throw new Error("Telegram session is no longer authorized");
        cache.client = client;
        return client;
    })();
    try { return await cache.connecting; } finally { cache.connecting = null; }
}

/**
 * Read message history of a chat (does NOT mark as read).
 * ctx.fns.telegram.messages({ chat: "-1001184192226", max?: 50 })
 *   chat: chat id (string or number) or @username.
 * Returns oldest→newest within the fetched window.
 * → [{ id, date, sender, text, replyTo }]
 */
function senderName(sender: any): string {
    if (!sender) return "Unknown";
    if ("firstName" in sender) return sender.firstName + (sender.lastName ? ` ${sender.lastName}` : "");
    if ("title" in sender) return sender.title;
    return "Unknown";
}


function mediaInfo(msg: any) {
    const document = msg.document ?? msg.media?.document;
    const photo = msg.photo ?? msg.media?.photo;
    if (photo) return { kind: "photo", mimeType: "image/jpeg", fileName: `telegram-${msg.id}.jpg`, size: null };
    if (!document) return null;

    const attrs = Array.isArray(document.attributes) ? document.attributes : [];
    const fileName = attrs.find((a: any) => typeof a?.fileName === "string")?.fileName ?? null;
    const mimeType = typeof document.mimeType === "string" ? document.mimeType : "application/octet-stream";
    const isVoice = attrs.some((a: any) => a?.voice === true);
    const isRoundVideo = attrs.some((a: any) => a?.roundMessage === true);
    const isAnimated = attrs.some((a: any) => a?.className === "DocumentAttributeAnimated");
    const isSticker = attrs.some((a: any) => a?.className === "DocumentAttributeSticker");
    const kind = isSticker ? "sticker" : isVoice ? "voice" : isRoundVideo ? "video" : isAnimated ? "animation"
        : mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video"
        : mimeType.startsWith("audio/") ? "audio" : "document";
    return { kind, mimeType, fileName, size: Number(document.size ?? 0) || null };
}

/**
 * Lists recent messages in a Telegram chat.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Operation options.
 * @returns The operation result.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Chat identifier or username. */
        chat: string | number;
        /** Maximum number of results to return. */
        max?: number;
    }) {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("messages: opts.chat required (chat id or @username)");
    const client = await connected(ctx);
    const msgs = await client.getMessages(String(opts.chat), { limit: opts.max ?? 50 });
    const result: any[] = [];
    for (const msg of [...msgs].reverse()) {
        result.push({
            id: msg.id,
            date: new Date(msg.date * 1000).toISOString(),
            sender: senderName(msg.sender),
            senderId: (msg.senderId as any)?.toString?.() ?? null,
            outgoing: !!msg.out,
            text: msg.message || "",
            media: mediaInfo(msg),
            hasPhoto: !!(msg as any).photo,
            replyTo: (msg.replyTo as any)?.replyToMsgId,
        });
    }
    return result;
}
