import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * Sends one request to the inbox relay signed with this Hyper's key (NIP-98 HTTP auth: kind 27235 event with u, method,
 * payload hash and a random nonce, in `Authorization: Nostr <base64>`). Low-level transport used by the other inbox functions.
 * @param opts.conn Relay connection with this Hyper's key.
 * @param opts.method HTTP method.
 * @param opts.path Path with query, for example /v1/relay/inbox?after=0.
 * @param opts.body JSON body; omitted for GET and DELETE.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Relay connection with this Hyper's key. */
    conn: types.inbox.Conn;
    /** HTTP method. */
    method: "GET" | "PUT" | "POST" | "DELETE";
    /** Path with query, for example /v1/relay/inbox?after=0. */
    path: string;
    /** JSON body; omitted for GET and DELETE. */
    body?: unknown;
}): Promise<{ status: number; body: any }> {
    const { conn, method, path } = opts;
    const url = conn.base.replace(/\/$/, "") + path;
    const text = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const tags = [["u", url], ["method", method], ["nonce", crypto.randomUUID()]];
    if (text) tags.push(["payload", bytesToHex(sha256(new TextEncoder().encode(text)))]);
    const sk = hexToBytes(conn.sk); const created_at = Math.floor(Date.now() / 1000);
    const id = sha256(new TextEncoder().encode(JSON.stringify([0, conn.npub, created_at, 27235, tags, ""])));
    const auth = { id: bytesToHex(id), pubkey: conn.npub, created_at, kind: 27235, tags, content: "", sig: bytesToHex(schnorr.sign(id, sk)) };
    const req = new Request(url, { method, headers: { authorization: "Nostr " + Buffer.from(JSON.stringify(auth)).toString("base64"), ...(text ? { "content-type": "application/json" } : {}) }, body: text || undefined });
    const res = await (conn.fetch ?? fetch)(req);
    const raw = await res.text();
    let body: any = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = { error: raw.slice(0, 200) }; }
    return { status: res.status, body };
}
