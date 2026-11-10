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
 * WRITE: add an existing chat to an existing Telegram chat folder, optionally pinned at the top.
 *
 * Use when a chat (a new group, a person) should appear in one of the account's folders. The folder is
 * found by numeric id or exact title. A pinned chat goes first in the folder's pinned list; adding a chat
 * already in the folder only changes its pinned state. Chat-list flags (contacts, groups, …) are kept.
 *
 * @param ctx Runtime context.
 * @param session Active session, when available.
 * @param opts Folder, chat and pin options.
 * @returns Folder id, title and resulting pinned / included peer counts.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Folder numeric id or exact title. */
        folder: number | string;
        /** Chat identifier or @username to add. */
        chat: string | number;
        /** Pin the chat at the top of the folder. @default false */
        pin?: boolean;
        /** Whether the caller confirmed the write operation. */
        confirm?: boolean;
    }): Promise<{ id: number; title: string; pinned: number; included: number }> {
    if (opts?.folder === undefined || opts?.folder === null || opts.folder === "") throw new Error("folderAddChat: opts.folder required");
    if (opts?.chat === undefined || opts?.chat === null) throw new Error("folderAddChat: opts.chat required");
    if (opts.confirm !== true) throw new Error("telegram.folderAddChat changes the account; repeat with confirm: true after explicit user approval");
    const client = await connected(ctx);
    const res: any = await client.invoke(new Api.messages.GetDialogFilters());
    const filters: any[] = res.filters || res;
    const title = (f: any) => typeof f.title === "string" ? f.title : f.title?.text ?? "";
    const f = filters.find((x) => x.className === "DialogFilter" && (typeof opts.folder === "number" ? x.id === opts.folder : title(x) === opts.folder));
    if (!f) throw new Error(`folderAddChat: folder ${opts.folder} not found`);
    const peer: any = await client.getInputEntity(String(opts.chat));
    const key = (p: any) => `${p.className}:${p.userId ?? p.chatId ?? p.channelId ?? ""}`;
    const k = key(peer);
    let pinned = (f.pinnedPeers ?? []).filter((p: any) => key(p) !== k);
    let include = (f.includePeers ?? []).filter((p: any) => key(p) !== k);
    if (opts.pin) pinned = [peer, ...pinned]; else include = [...include, peer];
    f.pinnedPeers = pinned;
    f.includePeers = include;
    f.excludePeers = (f.excludePeers ?? []).filter((p: any) => key(p) !== k);
    await client.invoke(new Api.messages.UpdateDialogFilter({ id: f.id, filter: f }));
    return { id: f.id, title: title(f), pinned: pinned.length, included: include.length };
}
