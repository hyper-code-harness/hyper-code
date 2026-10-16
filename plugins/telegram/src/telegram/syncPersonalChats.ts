/**
 * Mirrors recent personal Telegram dialogs and messages into the telegram Postgres schema
 *
 * Use for initial backfill or incremental refresh of personal one-to-one Telegram chats. It upserts Telegram User, Dialog, Message, MessageMedia, Photo, and Document metadata without downloading binary media files.
 * @param opts.maxChats Maximum recent personal dialogs to synchronize. @default 100 @minimum 1 @maximum 100
 * @param opts.maxMessages Maximum recent messages fetched per dialog. @default 1000 @minimum 1 @maximum 1000
 * @param opts.sessionId Stable local identifier for the authorized Telegram session. @default default
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Maximum recent personal dialogs to synchronize. @default 100 @minimum 1 @maximum 100 */
        maxChats?: number;
        /** Maximum recent messages fetched per dialog. @default 1000 @minimum 1 @maximum 1000 */
        maxMessages?: number;
        /** Stable local identifier for the authorized Telegram session. @default default */
        sessionId?: string;
    },
): Promise<{ chats: number; messages: number; media: number; errors: Array<{ chatId: string; error: string }> }> {
    const maxChats = opts.maxChats ?? 100;
    const maxMessages = opts.maxMessages ?? 1000;
    const sessionId = opts.sessionId ?? "default";
    
    const getSecret = async (ref: string) => {
      const name = ref.includes("session.txt") ? "session" : ref.includes("config.json") ? "config" : new Bun.CryptoHasher("sha256").update(ref).digest("hex").slice(0, 32);
      const value = await ctx.fns.secrets.get({ ref, namespace: "telegram", name });
      if (!value) throw new Error("Telegram credential is not configured");
      return value;
    };
    const root = globalThis as typeof globalThis & { [key: symbol]: any };
    const key = Symbol.for("hyper-code2.telegram.client.singleton");
    const cache = (root[key] ??= {});
    let client = cache.client;
    if (!client?.connected) {
      const { TelegramClient } = await import("telegram");
      const { StringSession } = await import("telegram/sessions");
      const [configRaw, sessionString] = await Promise.all([getSecret("op://hyper/telegram config.json/value"), getSecret("op://hyper/telegram session.txt/value")]);
      const config = JSON.parse(configRaw);
      client = new TelegramClient(new StringSession(sessionString.trim()), config.apiId, String(config.apiHash), { connectionRetries: 5 });
      await client.connect();
      cache.client = client;
    }
    const me: any = await client.getMe();
    const scalar = (v: any): string | null => v == null ? null : String(v);
    const iso = (seconds: any): string | null => Number(seconds) > 0 ? new Date(Number(seconds) * 1000).toISOString() : null;
    const className = (v: any): string => String(v?.className ?? "");
    const peer = (v: any): { type: string | null; id: string | null } => {
      if (!v) return { type: null, id: null };
      if (v.userId != null) return { type: "user", id: scalar(v.userId) };
      if (v.chatId != null) return { type: "chat", id: scalar(v.chatId) };
      if (v.channelId != null) return { type: "channel", id: scalar(v.channelId) };
      return { type: null, id: null };
    };
    const attrs = (doc: any) => (Array.isArray(doc?.attributes) ? doc.attributes : []).map((a: any) => ({ className: className(a), fileName: a?.fileName ?? null, duration: a?.duration ?? null, voice: a?.voice ?? null, roundMessage: a?.roundMessage ?? null, w: a?.w ?? null, h: a?.h ?? null }));
    await ctx.fns.procs.db.run({ sql:   "INSERT INTO telegram.sessions(id,self_user_id,dc_id,last_seen_at) VALUES(?,?,?,now()) ON CONFLICT(id) DO UPDATE SET self_user_id=excluded.self_user_id,dc_id=excluded.dc_id,last_seen_at=now()", params: [sessionId, scalar(me.id), Number(me.photo?.dcId ?? 0) || null] });
    await ctx.fns.procs.db.run({ sql:   "INSERT INTO telegram.users(id,access_hash,username,first_name,last_name,phone,raw,updated_at) VALUES(?,?,?,?,?,?,?::jsonb,now()) ON CONFLICT(id) DO UPDATE SET access_hash=excluded.access_hash,username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,raw=excluded.raw,updated_at=now()", params: [scalar(me.id), scalar(me.accessHash), me.username ?? null, me.firstName ?? null, me.lastName ?? null, me.phone ?? null, JSON.stringify({ className: className(me), bot: !!me.bot, verified: !!me.verified })] });
    
    const dialogs: any[] = await client.getDialogs({ limit: Math.max(maxChats * 10, maxChats) });
    const personal = dialogs.filter((d: any) => className(d.entity) === "User" && !d.entity?.bot).slice(0, maxChats);
    let chats = 0, messageCount = 0, mediaCount = 0;
    const errors: Array<{ chatId: string; error: string }> = [];
    for (const d of personal) {
      const u: any = d.entity;
      const chatId = scalar(u.id)!;
      try {
        await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.users(id,access_hash,username,first_name,last_name,phone,raw,updated_at) VALUES(?,?,?,?,?,?,?::jsonb,now()) ON CONFLICT(id) DO UPDATE SET access_hash=excluded.access_hash,username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,raw=excluded.raw,updated_at=now()", params: [chatId, scalar(u.accessHash), u.username ?? null, u.firstName ?? null, u.lastName ?? null, u.phone ?? null, JSON.stringify({ className: className(u), bot: !!u.bot, verified: !!u.verified, contact: !!u.contact })] });
        await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.dialogs(session_id,peer_type,peer_id,top_message,read_inbox_max_id,read_outbox_max_id,unread_count,unread_mentions_count,folder_id,pinned,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,now()) ON CONFLICT(session_id,peer_type,peer_id) DO UPDATE SET top_message=excluded.top_message,read_inbox_max_id=excluded.read_inbox_max_id,read_outbox_max_id=excluded.read_outbox_max_id,unread_count=excluded.unread_count,unread_mentions_count=excluded.unread_mentions_count,folder_id=excluded.folder_id,pinned=excluded.pinned,synced_at=now()", params: [sessionId, "user", chatId, Number(d.topMessage ?? d.message?.id ?? 0) || null, Number(d.readInboxMaxId ?? 0) || null, Number(d.readOutboxMaxId ?? 0) || null, Number(d.unreadCount ?? 0), Number(d.unreadMentionsCount ?? 0), d.folderId == null ? null : Number(d.folderId), !!d.pinned] });
        const fetched: any[] = await client.getMessages(u, { limit: maxMessages });
        const rows: any[] = [], photos: any[] = [], documents: any[] = [], media: any[] = [], users = new Map<string, any>();
        for (const m of fetched) {
          const from = peer(m.fromId ?? m.peerId);
          if (className(m.sender) === "User" && m.sender?.id != null) users.set(String(m.sender.id), m.sender);
          rows.push({ id: String(m.id), from_type: from.type, from_id: from.id, reply_to: m.replyTo?.replyToMsgId == null ? null : String(m.replyTo.replyToMsgId), grouped_id: scalar(m.groupedId), out: !!m.out, message: String(m.message ?? ""), date: iso(m.date), edit_date: iso(m.editDate), views: m.views == null ? null : Number(m.views), forwards: m.forwards == null ? null : Number(m.forwards), entities: (m.entities ?? []).map((e: any) => ({ className: className(e), offset: e.offset, length: e.length })), raw: { className: className(m), post: !!m.post, mentioned: !!m.mentioned, mediaUnread: !!m.mediaUnread } });
          const photo: any = m.photo ?? m.media?.photo;
          const document: any = m.document ?? m.media?.document;
          if (photo?.id != null) {
            photos.push({ id: scalar(photo.id), access_hash: scalar(photo.accessHash), dc_id: photo.dcId == null ? null : Number(photo.dcId), date: iso(photo.date), raw: { className: className(photo), hasStickers: !!photo.hasStickers } });
            media.push({ message_id: String(m.id), type: "photo", photo_id: scalar(photo.id), document_id: null, spoiler: !!m.media?.spoiler, ttl_seconds: m.media?.ttlSeconds ?? null, raw: { className: className(m.media) } });
          } else if (document?.id != null) {
            documents.push({ id: scalar(document.id), access_hash: scalar(document.accessHash), mime_type: document.mimeType ?? null, size: scalar(document.size), dc_id: document.dcId == null ? null : Number(document.dcId), date: iso(document.date), attributes: attrs(document), raw: { className: className(document) } });
            media.push({ message_id: String(m.id), type: "document", photo_id: null, document_id: scalar(document.id), spoiler: !!m.media?.spoiler, ttl_seconds: m.media?.ttlSeconds ?? null, raw: { className: className(m.media) } });
          } else if (m.media) media.push({ message_id: String(m.id), type: className(m.media).replace(/^MessageMedia/, "").toLowerCase() || "unknown", photo_id: null, document_id: null, spoiler: !!m.media?.spoiler, ttl_seconds: m.media?.ttlSeconds ?? null, raw: { className: className(m.media) } });
        }
        for (const sender of users.values()) await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.users(id,access_hash,username,first_name,last_name,phone,raw,updated_at) VALUES(?,?,?,?,?,?,?::jsonb,now()) ON CONFLICT(id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,updated_at=now()", params: [scalar(sender.id), scalar(sender.accessHash), sender.username ?? null, sender.firstName ?? null, sender.lastName ?? null, sender.phone ?? null, JSON.stringify({ className: className(sender) })] });
        if (rows.length) await ctx.fns.procs.db.run({ sql:       "INSERT INTO telegram.messages(session_id,peer_type,peer_id,id,from_id_type,from_id,reply_to_msg_id,grouped_id,out,message,date,edit_date,views,forwards,entities,raw) SELECT ?, 'user', ?::bigint, x.id::bigint,x.from_type,x.from_id::bigint,x.reply_to::bigint,x.grouped_id::numeric,x.out,x.message,x.date::timestamptz,x.edit_date::timestamptz,x.views,x.forwards,x.entities,x.raw FROM jsonb_to_recordset(?::jsonb) AS x(id text,from_type text,from_id text,reply_to text,grouped_id text,out boolean,message text,date text,edit_date text,views integer,forwards integer,entities jsonb,raw jsonb) ON CONFLICT(session_id,peer_type,peer_id,id) DO UPDATE SET from_id_type=excluded.from_id_type,from_id=excluded.from_id,reply_to_msg_id=excluded.reply_to_msg_id,grouped_id=excluded.grouped_id,out=excluded.out,message=excluded.message,date=excluded.date,edit_date=excluded.edit_date,views=excluded.views,forwards=excluded.forwards,entities=excluded.entities,raw=excluded.raw,deleted_at=NULL", params: [sessionId, chatId, JSON.stringify(rows)] });
        const uniquePhotos = [...new Map(photos.map((item: any) => [item.id, item])).values()];
        const uniqueDocuments = [...new Map(documents.map((item: any) => [item.id, item])).values()];
        if (uniquePhotos.length) await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.photos(id,access_hash,dc_id,date,raw) SELECT x.id::bigint,x.access_hash::bigint,x.dc_id,x.date::timestamptz,x.raw FROM jsonb_to_recordset(?::jsonb) AS x(id text,access_hash text,dc_id integer,date text,raw jsonb) ON CONFLICT(id) DO UPDATE SET access_hash=excluded.access_hash,dc_id=excluded.dc_id,date=excluded.date,raw=excluded.raw", params: [JSON.stringify(uniquePhotos)] });
        if (uniqueDocuments.length) await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.documents(id,access_hash,mime_type,size,dc_id,date,attributes,raw) SELECT x.id::bigint,x.access_hash::bigint,x.mime_type,x.size::bigint,x.dc_id,x.date::timestamptz,x.attributes,x.raw FROM jsonb_to_recordset(?::jsonb) AS x(id text,access_hash text,mime_type text,size text,dc_id integer,date text,attributes jsonb,raw jsonb) ON CONFLICT(id) DO UPDATE SET access_hash=excluded.access_hash,mime_type=excluded.mime_type,size=excluded.size,dc_id=excluded.dc_id,date=excluded.date,attributes=excluded.attributes,raw=excluded.raw", params: [JSON.stringify(uniqueDocuments)] });
        if (media.length) await ctx.fns.procs.db.run({ sql: "INSERT INTO telegram.message_media(session_id,peer_type,peer_id,message_id,position,type,photo_id,document_id,spoiler,ttl_seconds,raw) SELECT ?,'user',?::bigint,x.message_id::bigint,0,x.type,x.photo_id::bigint,x.document_id::bigint,x.spoiler,x.ttl_seconds,x.raw FROM jsonb_to_recordset(?::jsonb) AS x(message_id text,type text,photo_id text,document_id text,spoiler boolean,ttl_seconds integer,raw jsonb) ON CONFLICT(session_id,peer_type,peer_id,message_id,position) DO UPDATE SET type=excluded.type,photo_id=excluded.photo_id,document_id=excluded.document_id,spoiler=excluded.spoiler,ttl_seconds=excluded.ttl_seconds,raw=excluded.raw", params: [sessionId, chatId, JSON.stringify(media)] });
        chats++; messageCount += rows.length; mediaCount += media.length;
      } catch (error) { errors.push({ chatId, error: String((error as Error)?.message ?? error) }); }
    }
    return { chats, messages: messageCount, media: mediaCount, errors };
}
