/**
 * Downloads and content-addresses one Telegram user avatar in the local file cache
 *
 * Use when a Telegram UI needs a durable cached avatar. Reuses the shared MTProto client, stores avatar bytes under the configured local Telegram media directory by SHA-256, and records only the file link and metadata in Postgres.
 * @param opts.userId Telegram User identifier whose current profile photo should be cached.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Telegram User identifier whose current profile photo should be cached. */
        userId: string | number;
    },
): Promise<{ userId: string; photoId: string | null; sha256: string; storagePath: string; mimeType: string; size: number } | null> {
    if (opts?.userId == null) throw new Error("telegram.cacheUserAvatar requires userId");
    const getSecret = async (ref: string) => { const name = ref.includes("session.txt") ? "session" : ref.includes("config.json") ? "config" : new Bun.CryptoHasher("sha256").update(ref).digest("hex").slice(0, 32); const value = await ctx.fns.secrets.get({ ref, namespace: "telegram", name }); if (!value) throw new Error("Telegram credential is not configured"); return value; };
    const root = globalThis as typeof globalThis & { [key: symbol]: any }; const key = Symbol.for("hyper-code2.telegram.client.singleton"); const cache = (root[key] ??= {}); let client = cache.client;
    if (!client?.connected) { const { TelegramClient } = await import("telegram"); const { StringSession } = await import("telegram/sessions"); const [configRaw, sessionString] = await Promise.all([getSecret("op://hyper/telegram config.json/value"), getSecret("op://hyper/telegram session.txt/value")]); const config = JSON.parse(configRaw); client = new TelegramClient(new StringSession(sessionString.trim()), config.apiId, String(config.apiHash), { connectionRetries: 5 }); await client.connect(); cache.client = client; }
    const user: any = await client.getEntity(String(opts.userId)); if (!user?.photo) return null;
    const photoId = user.photo?.photoId?.toString?.() ?? user.photo?.id?.toString?.() ?? null;
    const previous: any[] = await ctx.fns.procs.db.select({ sql: "SELECT a.photo_id::text,f.sha256,f.storage_path,f.mime_type,f.size FROM telegram.user_avatars a JOIN telegram.files f ON f.sha256=a.file_sha256 WHERE a.user_id=?::bigint AND (?::bigint IS NULL OR a.photo_id=?::bigint)", params: [String(opts.userId), photoId, photoId] });
    if (previous[0] && await ctx.fns.files.exists({ path: String(previous[0].storage_path) })) return { userId: String(opts.userId), photoId, sha256: String(previous[0].sha256), storagePath: String(previous[0].storage_path), mimeType: String(previous[0].mime_type ?? "image/jpeg"), size: Number(previous[0].size) };
    const buffer: any = await client.downloadProfilePhoto(user, { isBig: false }); if (!buffer?.length) return null;
    const bytes = new Uint8Array(buffer); const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex"); const dir = "/tmp/hyper-telegram-media/avatars"; await ctx.fns.files.mkdir({ path: dir }); const storagePath = dir + "/" + sha256 + ".jpg"; if (!(await ctx.fns.files.exists({ path: storagePath }))) await Bun.write(storagePath, bytes);
    await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.files(sha256,storage_path,size,mime_type,verified_at) VALUES(?,?,?,?,now()) ON CONFLICT(sha256) DO UPDATE SET storage_path=excluded.storage_path,size=excluded.size,mime_type=excluded.mime_type,verified_at=now()", params: [sha256, storagePath, bytes.length, "image/jpeg"] });
    await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.user_avatars(user_id,photo_id,file_sha256,cached_at) VALUES(?::bigint,?::bigint,?,now()) ON CONFLICT(user_id) DO UPDATE SET photo_id=excluded.photo_id,file_sha256=excluded.file_sha256,cached_at=now()", params: [String(opts.userId), photoId, sha256] });
    return { userId: String(opts.userId), photoId, sha256, storagePath, mimeType: "image/jpeg", size: bytes.length };
}
