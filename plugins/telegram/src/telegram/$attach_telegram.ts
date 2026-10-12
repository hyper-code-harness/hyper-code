import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events";
import { StringSession } from "telegram/sessions";

const telegramClientKey = Symbol.for("hyper-code2.telegram.client.singleton");
type TelegramCache = { client?: TelegramClient; connecting?: Promise<TelegramClient> | null };

async function secret(ctx: Context, ref: string): Promise<string> {
    const name = ref.includes("session.txt") ? "session" : "config";
    const value = await ctx.fns.secrets.get({ ref, namespace: "telegram", name });
    if (!value) throw new Error("Telegram credential is not configured");
    return value;
}

async function connected(ctx: Context): Promise<TelegramClient> {
    const root = globalThis as typeof globalThis & { [telegramClientKey]?: TelegramCache };
    const cache = (root[telegramClientKey] ??= {});
    const legacy = (ctx.state as any).telegram;
    if (!cache.client?.connected && legacy?.client?.connected) cache.client = legacy.client;
    if (cache.client?.connected) return cache.client;
    if (cache.connecting) return await cache.connecting;
    cache.connecting = (async () => {
        const [configRaw, sessionString] = await Promise.all([
            secret(ctx, "op://hyper/telegram config.json/value"),
            secret(ctx, "op://hyper/telegram session.txt/value"),
        ]);
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

export default {
    events: ["message.new"],
    async start(opts: {
        ctx: Context;
        emit: (event: { eventId: string; eventType: string; payload: Record<string, any>; occurredAt?: number }) => Promise<unknown>;
        signal: AbortSignal;
    }) {
        const client = await connected(opts.ctx);
        // Listen to both incoming and outgoing messages. Personal "notes/todo"
        // chats are commonly written by the authorized account itself, so
        // incoming-only would silently miss the main attach use case.
        const builder = new NewMessage({});
        const handler = async (event: any) => {
            const message = event?.message;
            if (!message) return;
            const chatId = message.chatId?.toString?.() ?? message.peerId?.channelId?.toString?.() ?? message.peerId?.chatId?.toString?.() ?? message.peerId?.userId?.toString?.();
            const senderId = message.senderId?.toString?.() ?? message.fromId?.userId?.toString?.() ?? null;
            const messageId = Number(message.id);
            if (!chatId || !Number.isFinite(messageId)) return;
            const text = String(message.message ?? "").slice(0, 16000);
            const dateSeconds = Number(message.date ?? Math.floor(Date.now() / 1000));
            await opts.emit({
                eventId: `${chatId}:${messageId}`,
                eventType: "message.new",
                occurredAt: dateSeconds * 1000,
                payload: {
                    chatId,
                    messageId,
                    senderId,
                    text,
                    replyToMessageId: message.replyTo?.replyToMsgId ? Number(message.replyTo.replyToMsgId) : null,
                    groupedId: message.groupedId?.toString?.() ?? null,
                },
            });
        };
        client.addEventHandler(handler, builder);
        const stop = () => client.removeEventHandler(handler, builder);
        opts.signal.addEventListener("abort", stop, { once: true });
        return { stop };
    },
};
