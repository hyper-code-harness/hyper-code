/**
 * Disconnects live-view viewers, so the human can no longer see or drive the tab.
 *
 * Use when the hand-off is over (the human finished the CAPTCHA or login) before the agent continues
 * automating the tab, or to revoke a link that was shared. Without `targetId` every viewer is closed.
 * Open viewer pages show "stopped" and do not reconnect until the person reloads them.
 * @param opts.targetId Close only viewers showing this Chrome target id.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Close only viewers showing this Chrome target id. */
        targetId?: string;
    } = {},
): Promise<{ closed: number }> {
    const live: Set<any> = (ctx.state as any).browser?.live ?? new Set();
    let closed = 0;
    for (const st of [...live]) {
        if (opts.targetId && st.conn?.targetId() !== opts.targetId) continue;
        live.delete(st);
        await st.conn?.close();
        // 4000: stopped on purpose — the viewer page does not reconnect.
        try { st.ws?.close(4000, "Live view stopped"); } catch { /* already closed */ }
        closed++;
    }
    return { closed };
}
