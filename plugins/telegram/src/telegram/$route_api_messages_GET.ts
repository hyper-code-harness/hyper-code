/** Returns recent messages from one personal Telegram dialog without marking them read. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const chat = String(url.searchParams.get("chat") ?? "").trim();
    if (!chat) return Response.json({ error: "chat is required" }, { status: 400 });
    const max = Math.max(1, Math.min(200, Number(url.searchParams.get("max") ?? 80)));
    const rows: any[] = await ctx.fns.procs.db.select({ sql: "SELECT m.id,m.date,m.message AS text,m.out AS outgoing,m.from_id::text AS sender_id,COALESCE(NULLIF(concat_ws(' ',u.first_name,u.last_name),''),u.username,'Unknown') AS sender,m.reply_to_msg_id AS reply_to FROM (SELECT * FROM telegram.messages WHERE session_id='default' AND peer_type='user' AND peer_id=?::bigint ORDER BY date DESC,id DESC LIMIT ?) m LEFT JOIN telegram.users u ON u.id=m.from_id ORDER BY m.date,m.id", params: [chat, max] });
    const messages = rows.map(row => ({ id: Number(row.id), date: new Date(row.date).toISOString(), sender: String(row.sender), senderId: row.sender_id == null ? null : String(row.sender_id), outgoing: !!row.outgoing, text: String(row.text ?? ""), replyTo: row.reply_to == null ? null : Number(row.reply_to) }));
    return Response.json({ messages });
}
