/**
 * Reads personal Telegram dialogs and message history from the local Postgres mirror
 *
 * Use for Telegram user interfaces and local search that must read synchronized data from the telegram schema instead of calling Telegram MTProto. Returns recent personal dialogs plus bounded message histories and media metadata.
 * @param opts.maxDialogs Maximum recent personal dialogs returned. @default 30 @minimum 1 @maximum 100
 * @param opts.maxMessages Maximum recent messages returned per dialog. @default 80 @minimum 1 @maximum 1000
 * @param opts.sessionId Local synchronized Telegram session identifier. @default default
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Maximum recent personal dialogs returned. @default 30 @minimum 1 @maximum 100 */
        maxDialogs?: number;
        /** Maximum recent messages returned per dialog. @default 80 @minimum 1 @maximum 1000 */
        maxMessages?: number;
        /** Local synchronized Telegram session identifier. @default default */
        sessionId?: string;
    },
): Promise<{ dialogs: Array<{ id: string; title: string; username: string | null; unreadCount: number; lastMessage: string | null; date: string | null; avatarUrl: string }>; histories: Record<string, Array<{ id: number; date: string; sender: string; senderId: string | null; outgoing: boolean; text: string; replyTo: number | null; media: { kind: string; mimeType: string | null; fileName: string | null; size: number | null; storagePath: string | null } | null }>> }> {
    const maxDialogs = opts.maxDialogs ?? 30;
    const maxMessages = opts.maxMessages ?? 80;
    const sessionId = opts.sessionId ?? "default";
    const dialogsRaw: any[] = await ctx.fns.procs.db.select({ sql:   "SELECT d.peer_id::text AS id, COALESCE(NULLIF(concat_ws(' ',u.first_name,u.last_name),''),u.username,'Unknown') AS title,u.username,d.unread_count,top.message AS last_message,top.date FROM telegram.dialogs d JOIN telegram.users u ON u.id=d.peer_id LEFT JOIN LATERAL (SELECT m.message,m.date FROM telegram.messages m WHERE m.session_id=d.session_id AND m.peer_type=d.peer_type AND m.peer_id=d.peer_id ORDER BY m.date DESC,m.id DESC LIMIT 1) top ON true WHERE d.session_id=? AND d.peer_type='user' ORDER BY top.date DESC NULLS LAST LIMIT ?", params: [sessionId, maxDialogs] });
    const dialogs = dialogsRaw.map(d => ({ id: String(d.id), title: String(d.title), username: d.username == null ? null : String(d.username), unreadCount: Number(d.unread_count ?? 0), lastMessage: d.last_message == null ? null : String(d.last_message), date: d.date == null ? null : new Date(d.date).toISOString(), avatarUrl: `/telegram/api/avatar/${encodeURIComponent(String(d.id))}` }));
    const histories: Record<string, Array<{ id: number; date: string; sender: string; senderId: string | null; outgoing: boolean; text: string; replyTo: number | null; media: { kind: string; mimeType: string | null; fileName: string | null; size: number | null; storagePath: string | null } | null }>> = {};
    for (const dialog of dialogs) {
      const rows: any[] = await ctx.fns.procs.db.select({ sql:     "SELECT m.id,m.date,m.message,m.out,m.from_id::text AS sender_id,m.reply_to_msg_id,COALESCE(NULLIF(concat_ws(' ',u.first_name,u.last_name),''),u.username,'Unknown') AS sender,mm.type AS media_type,d.mime_type,d.size,d.attributes,fl.storage_path FROM (SELECT * FROM telegram.messages WHERE session_id=? AND peer_type='user' AND peer_id=?::bigint ORDER BY date DESC,id DESC LIMIT ?) m LEFT JOIN telegram.users u ON u.id=m.from_id LEFT JOIN telegram.message_media mm ON mm.session_id=m.session_id AND mm.peer_type=m.peer_type AND mm.peer_id=m.peer_id AND mm.message_id=m.id AND mm.position=0 LEFT JOIN telegram.documents d ON d.id=mm.document_id LEFT JOIN telegram.file_links link ON link.owner_type=CASE WHEN mm.document_id IS NOT NULL THEN 'document' ELSE 'photo' END AND link.owner_id=COALESCE(mm.document_id,mm.photo_id) AND link.variant='original' LEFT JOIN telegram.files fl ON fl.sha256=link.file_sha256 ORDER BY m.date,m.id", params: [sessionId, dialog.id, maxMessages] });
      histories[dialog.id] = rows.map(row => { const attributes = Array.isArray(row.attributes) ? row.attributes : []; const fileName = attributes.find((a: any) => typeof a?.fileName === "string")?.fileName ?? null; return { id: Number(row.id), date: new Date(row.date).toISOString(), sender: String(row.sender ?? "Unknown"), senderId: row.sender_id == null ? null : String(row.sender_id), outgoing: !!row.out, text: String(row.message ?? ""), replyTo: row.reply_to_msg_id == null ? null : Number(row.reply_to_msg_id), media: row.media_type == null ? null : { kind: String(row.media_type), mimeType: row.mime_type == null ? (row.media_type === "photo" ? "image/jpeg" : null) : String(row.mime_type), fileName, size: row.size == null ? null : Number(row.size), storagePath: row.storage_path == null ? null : String(row.storage_path) } }; });
    }
    return { dialogs, histories };
}
