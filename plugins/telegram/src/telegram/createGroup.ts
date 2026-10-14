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
 * WRITE: create a group chat and invite people. ctx.fns.telegram.createGroup({ title, users, confirm: true })
 *   title: group title; users: @usernames, numeric ids or phone contacts to add at creation.
 *   supergroup: create a megagroup (channel with megagroup flag) instead of a basic group — needed for
 *   more than 200 members, admin rights per member and permanent history. Basic groups are cheaper and
 *   can be upgraded later by Telegram itself.
 *   Members that Telegram refuses to add (privacy settings, "cannot be invited") are reported in
 *   `missing` instead of failing the whole call — the group is still created.
 * → { id, title, kind, added, missing, inviteLink }
 */
/**
 * Creates a Telegram group or supergroup and invites the given users, after write confirmation.
 *
 * Use when a new chat has to exist for a team, incident or topic and the members are already known.
 * Members whose privacy settings forbid an invite are returned in `missing`, so the caller can send
 * them the invite link instead.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Operation options.
 * @returns Identifier and membership outcome of the created chat.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Title of the new chat. */
        title: string;
        /** Users to invite: @usernames, numeric ids or contact phone numbers. @minItems 1 */
        users: (string | number)[];
        /** Create a supergroup (megagroup) rather than a basic group. @default false */
        supergroup?: boolean;
        /** Description, supergroups only. */
        about?: string;
        /** Explicit approval for this real write. Set only when the user asked for this very group. @default false */
        confirm?: boolean;
    }): Promise<{
        /** Numeric chat id, negative form usable with telegram.send. */
        id: string;
        /** Title Telegram stored. */
        title: string;
        /** Which kind of chat was created. */
        kind: "group" | "supergroup";
        /** Usernames or ids Telegram accepted into the chat. */
        added: string[];
        /** Members Telegram refused to add, with the reason. */
        missing: { user: string; reason: string }[];
        /** Invite link, when one could be exported. */
        inviteLink: string | null;
    }> {
    if (!opts?.title) throw new Error("createGroup: opts.title required");
    if (!opts?.users?.length) throw new Error("createGroup: opts.users required");
    if (opts.confirm !== true) throw new Error("telegram.createGroup is a real write; repeat with confirm: true after explicit user approval");

    const client = await connected(ctx);

    const resolved: { key: string; entity: any }[] = [];
    const missing: { user: string; reason: string }[] = [];
    for (const u of opts.users) {
        const key = String(u);
        try { resolved.push({ key, entity: await client.getInputEntity(key) }); }
        catch (e: any) { missing.push({ user: key, reason: `not resolvable: ${e?.message ?? e}` }); }
    }
    if (!resolved.length) throw new Error("createGroup: none of the users could be resolved");

    let chatId: string;
    let kind: "group" | "supergroup";
    const added: string[] = [];

    if (opts.supergroup) {
        const created: any = await client.invoke(new Api.channels.CreateChannel({
            title: opts.title,
            about: opts.about ?? "",
            megagroup: true,
        }));
        const channel = created.chats?.[0];
        if (!channel) throw new Error("createGroup: Telegram returned no channel");
        chatId = `-100${channel.id}`;
        kind = "supergroup";
        const invited: any = await client.invoke(new Api.channels.InviteToChannel({
            channel,
            users: resolved.map((r) => r.entity),
        }));
        const refused = new Set((invited?.missingInvitees ?? []).map((m: any) => String(m.userId)));
        for (const r of resolved) {
            if (refused.size && refused.has(String((r.entity as any).userId ?? ""))) missing.push({ user: r.key, reason: "privacy settings forbid the invite" });
            else added.push(r.key);
        }
    } else {
        const created: any = await client.invoke(new Api.messages.CreateChat({
            title: opts.title,
            users: resolved.map((r) => r.entity),
        }));
        const chat = created.chats?.[0] ?? created.updates?.chats?.[0];
        if (!chat) throw new Error("createGroup: Telegram returned no chat");
        chatId = `-${chat.id}`;
        kind = "group";
        const refused = new Set((created?.missingInvitees ?? []).map((m: any) => String(m.userId)));
        for (const r of resolved) {
            if (refused.size && refused.has(String((r.entity as any).userId ?? ""))) missing.push({ user: r.key, reason: "privacy settings forbid the invite" });
            else added.push(r.key);
        }
    }

    let inviteLink: string | null = null;
    try {
        const link: any = await client.invoke(new Api.messages.ExportChatInvite({ peer: chatId }));
        inviteLink = link?.link ?? null;
    } catch { inviteLink = null; }

    return { id: chatId, title: opts.title, kind, added, missing, inviteLink };
}
