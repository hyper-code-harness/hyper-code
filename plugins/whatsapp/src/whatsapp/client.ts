import makeWASocket, { useMultiFileAuthState, Browsers, fetchLatestBaileysVersion, DisconnectReason, jidNormalizedUser } from "@whiskeysockets/baileys";
import pino from "pino";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

type WaState = {
    sock?: any;
    status: "idle" | "connecting" | "qr" | "open" | "closed" | "loggedOut";
    qr?: string;
    qrAt?: number;
    me?: { id: string; name?: string };
    lastError?: string;
    starting?: Promise<void> | null;
    waiters: Array<() => void>;
};
const key = Symbol.for("hyper.whatsapp.client");
const authDir = join(homedir(), ".hyper", "whatsapp", "auth");

function textOf(m: any): { type: string; text: string | null } {
    const msg = m?.message ?? {};
    const inner = msg.ephemeralMessage?.message ?? msg.viewOnceMessage?.message ?? msg.viewOnceMessageV2?.message ?? msg.documentWithCaptionMessage?.message ?? msg;
    const type = Object.keys(inner).find((k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage") ?? "unknown";
    const v = inner[type] ?? {};
    const text = typeof v === "string" ? v : v.text ?? v.caption ?? v.conversation ?? (type === "reactionMessage" ? v.text : null) ?? (v.fileName ? `[file] ${v.fileName}` : null);
    return { type, text: text ?? null };
}
function tsOf(t: any): string | null {
    if (t == null) return null;
    const n = typeof t === "number" ? t : typeof t === "object" && "low" in t ? t.low >>> 0 : Number(t);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

async function saveChats(ctx: Context, chats: any[]) {
    for (const c of chats) {
        if (!c?.id || c.id === "status@broadcast") continue;
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO whatsapp.chats(jid, name, is_group, unread, last_ts, updated_at) VALUES (?, ?, ?, ?, ?, now())
                  ON CONFLICT (jid) DO UPDATE SET name = COALESCE(EXCLUDED.name, whatsapp.chats.name), unread = COALESCE(EXCLUDED.unread, whatsapp.chats.unread),
                  last_ts = GREATEST(EXCLUDED.last_ts, whatsapp.chats.last_ts), updated_at = now()`,
            params: [c.id, c.name ?? c.subject ?? null, String(c.id).endsWith("@g.us"), c.unreadCount ?? null, tsOf(c.conversationTimestamp ?? c.lastMessageRecvTimestamp)],
        });
    }
}
async function saveContacts(ctx: Context, contacts: any[]) {
    for (const c of contacts) {
        if (!c?.id) continue;
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO whatsapp.contacts(jid, name, notify, updated_at) VALUES (?, ?, ?, now())
                  ON CONFLICT (jid) DO UPDATE SET name = COALESCE(EXCLUDED.name, whatsapp.contacts.name), notify = COALESCE(EXCLUDED.notify, whatsapp.contacts.notify), updated_at = now()`,
            params: [c.id, c.name ?? null, c.notify ?? c.verifiedName ?? null],
        });
    }
}
async function saveMessages(ctx: Context, messages: any[]) {
    for (const m of messages) {
        const chat = m?.key?.remoteJid;
        if (!chat || !m.key.id || chat === "status@broadcast") continue;
        const { type, text } = textOf(m);
        if (type === "protocolMessage") continue;
        const ts = tsOf(m.messageTimestamp);
        const sender = m.key.fromMe ? "me" : (m.key.participant ?? chat);
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO whatsapp.messages(chat_jid, id, from_me, sender, push_name, ts, type, text, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (chat_jid, id) DO UPDATE SET text = COALESCE(EXCLUDED.text, whatsapp.messages.text), push_name = COALESCE(EXCLUDED.push_name, whatsapp.messages.push_name)`,
            params: [chat, m.key.id, !!m.key.fromMe, sender, m.pushName ?? null, ts, type, text, JSON.stringify({ key: m.key, message: m.message ?? null })],
        });
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO whatsapp.chats(jid, is_group, last_ts) VALUES (?, ?, ?) ON CONFLICT (jid) DO UPDATE SET last_ts = GREATEST(EXCLUDED.last_ts, whatsapp.chats.last_ts)`,
            params: [chat, chat.endsWith("@g.us"), ts],
        });
        if (!m.key.fromMe && m.pushName) await saveContacts(ctx, [{ id: sender, notify: m.pushName }]);
    }
}
function safe(ctx: Context, label: string, p: Promise<unknown>) {
    p.catch((e) => { (ctx.fns as any).procs.log?.({ level: "warn", msg: `whatsapp ${label}: ${e?.message ?? e}` })?.catch?.(() => {}); });
}

async function start(ctx: Context, st: WaState) {
    await mkdir(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as any }));
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) as any, browser: Browsers.macOS("Hyper"), version, markOnlineOnConnect: false, syncFullHistory: false });
    st.sock = sock;
    st.status = "connecting";
    const wake = () => { const w = st.waiters.splice(0); w.forEach((f) => f()); };
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u: any) => {
        if (st.sock !== sock) return;
        if (u.qr) { st.qr = u.qr; st.qrAt = Date.now(); st.status = "qr"; safe(ctx, "qr-file", (async () => { const QR: any = (await import("qrcode")).default; await QR.toFile(join(homedir(), ".hyper", "whatsapp", "qr.png"), u.qr, { width: 420, margin: 2 }); })()); }
        if (u.connection === "open") {
            st.status = "open"; st.qr = undefined;
            st.me = { id: jidNormalizedUser(sock.user?.id), name: sock.user?.name };
            safe(ctx, "groups", (async () => { const g = await sock.groupFetchAllParticipating(); await saveChats(ctx, Object.values(g).map((x: any) => ({ id: x.id, subject: x.subject }))); })());
        }
        if (u.connection === "close") {
            const code = u.lastDisconnect?.error?.output?.statusCode;
            st.lastError = u.lastDisconnect?.error?.message;
            st.sock = undefined;
            if (code === DisconnectReason.loggedOut) {
                st.status = "loggedOut";
                safe(ctx, "logout-cleanup", rm(authDir, { recursive: true, force: true }));
            } else {
                st.status = "closed";
                setTimeout(() => { if (!st.sock && st.status === "closed") safe(ctx, "reconnect", ensure(ctx, st)); }, 2000);
            }
        }
        wake();
    });
    sock.ev.on("messaging-history.set", (h: any) =>  safe(ctx, "history", (async () => { await saveChats(ctx, h.chats ?? []); await saveContacts(ctx, h.contacts ?? []); await saveMessages(ctx, h.messages ?? []); })()));
    sock.ev.on("chats.upsert", (c: any) => safe(ctx, "chats", saveChats(ctx, c)));
    sock.ev.on("chats.update", (c: any) => safe(ctx, "chats", saveChats(ctx, c)));
    sock.ev.on("groups.upsert", (g: any) => safe(ctx, "groups", saveChats(ctx, g.map((x: any) => ({ id: x.id, subject: x.subject })))));
    sock.ev.on("groups.update", (g: any) => safe(ctx, "groups", saveChats(ctx, g.filter((x: any) => x.subject).map((x: any) => ({ id: x.id, subject: x.subject })))));
    sock.ev.on("contacts.upsert", (c: any) => safe(ctx, "contacts", saveContacts(ctx, c)));
    sock.ev.on("contacts.update", (c: any) => safe(ctx, "contacts", saveContacts(ctx, c)));
    sock.ev.on("messages.upsert", (u: any) => safe(ctx, "messages", saveMessages(ctx, u.messages ?? [])));
}
async function ensure(ctx: Context, st: WaState) {
    if (st.sock) return;
    if (st.starting) return await st.starting;
    st.starting = start(ctx, st);
    try { await st.starting; } finally { st.starting = null; }
}

/**
 * Returns the process-wide Baileys linked-device socket and its connection state, starting it on demand.
 *
 * Internal building block for the other whatsapp.* functions; it is not meant to be called directly by agents.
 * The socket persists its multi-file auth state in ~/.hyper/whatsapp/auth and mirrors history, chats, contacts
 * and incoming messages into the whatsapp Postgres schema. It waits until the connection is open, a QR code is
 * available, or the wait times out.
 *
 * @param opts.waitMs Maximum time to wait for an open connection or a QR code.
 * @param opts.requireOpen Throw when the connection is not open after waiting.
 * @param opts.restart Drop the current socket and start a fresh one.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Maximum time in milliseconds to wait for an open connection or a fresh QR code. @default 15000 @minimum 0 @maximum 120000 */
    waitMs?: number;
    /** Throw an error when the account is not linked and connected after waiting. @default false */
    requireOpen?: boolean;
    /** Close the current socket and start a new connection, e.g. to obtain a fresh QR after a logout. @default false */
    restart?: boolean;
}): Promise<{ sock: any; status: string; qr?: string; qrAt?: number; me?: { id: string; name?: string }; lastError?: string }> {
    const root = globalThis as any;
    const st: WaState = (root[key] ??= { status: "idle", waiters: [] });
    if (opts?.restart && st.sock) { const s = st.sock; st.sock = undefined; st.status = "idle"; try { s.end(undefined); } catch { /* socket already closed */ } }
    await ensure(ctx, st);
    const deadline = Date.now() + Math.max(0, Math.min(opts?.waitMs ?? 15000, 120000));
    while (st.status !== "open" && !(st.status === "qr" && !opts?.requireOpen) && st.status !== "loggedOut" && Date.now() < deadline) {
        await new Promise<void>((r) => { st.waiters.push(r); setTimeout(r, 500); });
    }
    if (opts?.requireOpen && st.status !== "open") throw new Error(`WhatsApp is not connected (status: ${st.status}); run whatsapp.login({}) and scan the QR code`);
    return { sock: st.sock, status: st.status, qr: st.qr, qrAt: st.qrAt, me: st.me, lastError: st.lastError };
}
