/**
 * Downloads media attached to one Telegram message into the managed temporary media directory
 *
 * Use when a UI or workflow needs to display, play, or offer a Telegram message attachment. Downloads photos, video, audio, stickers, and documents into a bounded temporary directory and returns a browser-readable data URL plus metadata.
 * @param opts.chat Chat identifier or username that owns the message.
 * @param opts.id Numeric Telegram message identifier.
 * @param opts.maxBytes Maximum attachment size accepted in bytes. @default 20971520 @minimum 1 @maximum 104857600
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Chat identifier or username that owns the message. */
        chat: string | number;
        /** Numeric Telegram message identifier. */
        id: number;
        /** Maximum attachment size accepted in bytes. @default 20971520 @minimum 1 @maximum 104857600 */
        maxBytes?: number;
    },
): Promise<{ path: string; bytes: number; mimeType: string; fileName: string; kind: string; dataUrl: string } | null> {
    if (opts?.chat == null || opts?.id == null) throw new Error("telegram.media requires chat and id");
    const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
    const getSecret = async (ref: string) => {
     const name = ref.includes("session.txt") ? "session" : ref.includes("config.json") ? "config" : new Bun.CryptoHasher("sha256").update(ref).digest("hex").slice(0, 32);
     const value = await ctx.fns.secrets.get({ ref, namespace: "telegram", name }); if (!value) throw new Error("Telegram credential is not configured"); return value;
    };
    const root = globalThis as typeof globalThis & { [key: symbol]: any }; const key = Symbol.for("hyper-code2.telegram.client.singleton"); const cache = (root[key] ??= {}); let client = cache.client;
    if (!client?.connected) { const { TelegramClient } = await import("telegram"); const { StringSession } = await import("telegram/sessions"); const [configRaw, sessionString] = await Promise.all([getSecret("op://hyper/telegram config.json/value"),getSecret("op://hyper/telegram session.txt/value")]); const config = JSON.parse(configRaw); client = new TelegramClient(new StringSession(sessionString.trim()), config.apiId, String(config.apiHash), { connectionRetries: 5 }); await client.connect(); cache.client = client; }
    const [message] = await client.getMessages(String(opts.chat), { ids: [opts.id] }); if (!message?.media) return null;
    const document = message.document ?? message.media?.document; const photo = message.photo ?? message.media?.photo; const attrs = Array.isArray(document?.attributes) ? document.attributes : [];
    const explicitName = attrs.find((a: any) => typeof a?.fileName === "string")?.fileName; const mimeType = photo ? "image/jpeg" : String(document?.mimeType || "application/octet-stream");
    const kind = photo ? "photo" : attrs.some((a: any) => a?.voice === true) ? "voice" : attrs.some((a: any) => a?.className === "DocumentAttributeSticker") ? "sticker" : mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "document";
    const ext = explicitName?.includes(".") ? explicitName.slice(explicitName.lastIndexOf(".")) : ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "application/pdf": ".pdf" } as Record<string,string>)[mimeType] ?? ".bin";
    const safeName = String(explicitName || ("telegram-" + opts.id + ext)).replace(/[^a-zA-Z0-9._-]+/g, "_"); const dir = "/tmp/hyper-telegram-media"; await ctx.fns.files.mkdir({ path: dir });
    const path = dir + "/" + String(opts.chat).replace(/[^a-zA-Z0-9_-]+/g, "_") + "-" + opts.id + "-" + safeName; const existing = await ctx.fns.files.exists({ path }); let bytes: Uint8Array;
    if (existing) { const file = Bun.file(path); if (file.size > maxBytes) throw new Error("Telegram attachment exceeds maxBytes"); bytes = new Uint8Array(await file.arrayBuffer()); } else { const buffer: any = await client.downloadMedia(message, {}); if (!buffer?.length) return null; if (buffer.length > maxBytes) throw new Error("Telegram attachment exceeds maxBytes"); bytes = new Uint8Array(buffer); await Bun.write(path, bytes); }
    return { path, bytes: bytes.length, mimeType, fileName: safeName, kind, dataUrl: "data:" + mimeType + ";base64," + Buffer.from(bytes).toString("base64") };
}
