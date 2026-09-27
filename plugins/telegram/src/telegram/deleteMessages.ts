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
 * Deletes one or more messages from a Telegram chat after write confirmation.
 *
 * Use to retract messages the user or an agent posted by mistake, addressing them by the
 * numeric ids returned from telegram.send, telegram.sendFile or telegram.messages.
 * Deletion is irreversible and, with revoke left on, removes the message for every
 * participant, so it requires confirm: true and is refused otherwise. Telegram only
 * permits deleting other people's messages where the account is an administrator, and
 * ordinary messages stay deletable for a limited time; failures surface as API errors.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Chat identifier or @username the messages belong to. */
    chat: string | number;
    /** Numeric message ids to delete. @minItems 1 */
    ids: number[];
    /** Delete for everyone rather than only in this account's history. @default true */
    revoke?: boolean;
    /** Explicit approval for this irreversible write. Set only when the user asked for this very deletion. @default false */
    confirm?: boolean;
}): Promise<{
    /** Chat the deletion was applied to. */
    chat: string;
    /** Message ids submitted for deletion. */
    requested: number[];
    /** Number of messages Telegram reported as affected. */
    deleted: number;
    /** Whether the messages were removed for every participant. */
    revoked: boolean;
}> {
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("deleteMessages: opts.chat required");
    if (!Array.isArray(opts?.ids) || !opts.ids.length) throw new Error("deleteMessages: opts.ids must list at least one message id");
    if (opts.ids.some(id => !Number.isInteger(id) || id <= 0)) throw new Error("deleteMessages: opts.ids must be positive integers");
    if (opts.confirm !== true) throw new Error("telegram.deleteMessages is an irreversible write; repeat with confirm: true after explicit user approval");

    const client = await connected(ctx);
    const revoke = opts.revoke !== false;
    const affected: any = await client.deleteMessages(String(opts.chat), opts.ids, { revoke });
    const deleted = Array.isArray(affected)
        ? affected.reduce((n: number, r: any) => n + (r?.ptsCount ?? 0), 0)
        : (affected?.ptsCount ?? 0);

    return { chat: String(opts.chat), requested: opts.ids, deleted, revoked: revoke };
}
