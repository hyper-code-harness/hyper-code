import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";

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
 * WRITE: set the avatar of a group or channel. ctx.fns.telegram.setChatPhoto({ chat, path, confirm: true })
 *   chat: chat id (negative for groups, -100… for supergroups) or @username; path: local image file.
 *   Telegram crops the picture to a circle, so the subject must sit in the middle of a square image.
 *   Requires the account to hold change-info rights in that chat.
 * → { chat, kind, file }
 */
/**
 * Replaces the photo of a Telegram group, supergroup or channel with a local image, after write confirmation.
 *
 * Use after creating a chat, or when a team wants a recognizable avatar. Basic groups and channels take
 * different MTProto calls; this picks the right one from the chat id.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Operation options.
 * @returns Which chat was updated and with which file.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Chat identifier or @username whose photo is replaced. */
        chat: string | number;
        /** Path to a local image file, square and at least 512x512 for a sharp result. */
        path: string;
        /** Explicit approval for this real write. Set only when the user asked for this very change. @default false */
        confirm?: boolean;
    }): Promise<{
        /** Chat the photo was applied to. */
        chat: string;
        /** Which MTProto path was used. */
        kind: "group" | "channel";
        /** Absolute path of the uploaded image. */
        file: string;
    }> {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("setChatPhoto: opts.chat required");
    if (!opts?.path) throw new Error("setChatPhoto: opts.path required");
    if (opts.confirm !== true) throw new Error("telegram.setChatPhoto is a real write; repeat with confirm: true after explicit user approval");

    const abs = opts.path.startsWith("/") ? opts.path : await ctx.fns.workspace.resolve({ path: opts.path });
    if (!(await Bun.file(abs).exists())) throw new Error(`setChatPhoto: file not found: ${abs}`);

    const client = await connected(ctx);
    const entity: any = await client.getEntity(String(opts.chat));
    const uploaded = await client.uploadFile({ file: new (await import("telegram/client/uploads")).CustomFile(
        abs.split("/").pop() ?? "photo.png",
        Bun.file(abs).size,
        abs,
    ), workers: 1 });

    const isChannel = entity?.className === "Channel";
    if (isChannel) {
        await client.invoke(new Api.channels.EditPhoto({
            channel: entity,
            photo: new Api.InputChatUploadedPhoto({ file: uploaded }),
        }));
    } else {
        await client.invoke(new Api.messages.EditChatPhoto({
            chatId: entity.id,
            photo: new Api.InputChatUploadedPhoto({ file: uploaded }),
        }));
    }

    return { chat: String(opts.chat), kind: isChannel ? "channel" : "group", file: abs };
}
