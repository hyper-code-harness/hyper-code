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

import { Api } from "telegram";

/**
 * WRITE: add a user or bot to an existing Telegram group, supergroup or channel.
 *
 * Use when a known person or bot must join a chat the account administers (for example a helper bot into a
 * family group). Basic groups use messages.AddChatUser, supergroups/channels use channels.InviteToChannel.
 * Privacy settings of a person may forbid the invite; the Telegram error is then passed through.
 * With admin: true the member is also made an administrator (in a basic group: a full admin; in a supergroup:
 * delete, pin, invite and manage rights) — a bot admin receives every group message regardless of privacy mode.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Chat and member.
 * @returns Chat id, added member and the MTProto path used.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Group or channel identifier. */
        chat: string | number;
        /** User or bot to add: @username, numeric id or contact phone. */
        user: string | number;
        /** Also make the member an administrator; an already present member is just promoted. @default false */
        admin?: boolean;
        /** Whether the caller confirmed the write operation. */
        confirm?: boolean;
    }): Promise<{ chat: string; user: string; kind: "group" | "channel" }> {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("addMember: opts.chat required");
    if (opts?.user === undefined || opts?.user === null || opts.user === "") throw new Error("addMember: opts.user required");
    if (opts.confirm !== true) throw new Error("telegram.addMember changes chat membership; repeat with confirm: true after explicit user approval");
    const client = await connected(ctx);
    const peer: any = await client.getInputEntity(String(opts.chat));
    const user: any = await client.getInputEntity(String(opts.user));
    if (peer.className === "InputPeerChat") {
        try { await client.invoke(new Api.messages.AddChatUser({ chatId: peer.chatId, userId: user, fwdLimit: 0 })); }
        catch (e: any) { if (!String(e?.message ?? e).includes("USER_ALREADY_PARTICIPANT")) throw e; }
        if (opts.admin) await client.invoke(new Api.messages.EditChatAdmin({ chatId: peer.chatId, userId: user, isAdmin: true }));
        return { chat: String(opts.chat), user: String(opts.user), kind: "group" };
    }
    if (peer.className === "InputPeerChannel") {
        try { await client.invoke(new Api.channels.InviteToChannel({ channel: peer, users: [user] })); }
        catch (e: any) { if (!String(e?.message ?? e).includes("USER_ALREADY_PARTICIPANT")) throw e; }
        if (opts.admin) await client.invoke(new Api.channels.EditAdmin({ channel: peer, userId: user, rank: "", adminRights: new Api.ChatAdminRights({ changeInfo: true, deleteMessages: true, banUsers: true, inviteUsers: true, pinMessages: true, manageCall: true, other: true }) }));
        return { chat: String(opts.chat), user: String(opts.user), kind: "channel" };
    }
    throw new Error("addMember: chat is not a group or channel");
}
