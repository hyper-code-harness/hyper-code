/**
 * Shows the inbox state of this Hyper: identity (relay, host, principal), whether a key exists and is registered, the public key,
 * background sync on/off, cursor and message counts. Never returns the secret key.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ identity: types.inbox.Self | null; error: string | null; npub: string | null; registered: boolean; running: boolean; cursor: number; received: number; sent: number; quarantined: number; inbox: string | null }> {
    let identity: types.inbox.Self | null = null; let error: string | null = null;
    try { identity = await ctx.fns.inbox.whoami({}); } catch (e: any) { error = String(e?.message ?? e); }
    const c = identity ? await ctx.fns.inbox.connection({}).catch(() => null) : null;
    const reg = await ctx.fns.inbox.getState({ key: "registered" });
    const counts = (await ctx.fns.procs.db.select({ sql: `SELECT count(*) FILTER (WHERE direction = 'in' AND verified)::int AS received, count(*) FILTER (WHERE direction = 'out')::int AS sent, count(*) FILTER (WHERE NOT verified)::int AS quarantined FROM inbox.messages` }) as any[])[0];
    return { identity, error, npub: c?.conn.npub ?? null, registered: !!(reg && c && reg.npub === c.conn.npub), running: !!(ctx.state as any).inbox?.running,
        cursor: Number(await ctx.fns.inbox.getState({ key: "cursor" }) ?? 0), received: counts.received, sent: counts.sent, quarantined: counts.quarantined,
        inbox: identity ? `inbox@${identity.host}` : null };
}
