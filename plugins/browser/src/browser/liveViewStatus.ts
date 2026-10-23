/**
 * Lists the live-view viewers currently connected to this Hyper and what each one shows.
 *
 * Use to check whether a human has the live view open (for example before resuming automation on that
 * tab). Each entry gives the Chrome endpoint, the shown target id, frame/input counters, time since the last
 * frame, Chrome's last measured answer time (-1 when it did not answer) and the current picture
 * profile (mode, adaptive level, JPEG quality, frame size limit).
 */
export default async function (ctx: Context, _session: Session | null, _opts: {} = {}): Promise<{
    viewers: Array<{ browserUrl: string; targetId: string; frames: number; dropped: number; inputs: number; connectedMs: number; lastFrameAgoMs: number; chromeMs: number; chromeOk: boolean; mode: string; level: number; quality: number; maxWidth: number; maxHeight: number }>;
}> {
    const live: Set<any> = (ctx.state as any).browser?.live ?? new Set();
    const viewers = [...live].filter((st) => st.conn).map((st) => {
        const s = st.conn.stats();
        return { browserUrl: String(st.browserUrl), targetId: st.conn.targetId(), frames: s.frames, dropped: s.dropped, inputs: s.inputs, connectedMs: Date.now() - s.since, lastFrameAgoMs: s.lastFrameAt ? Date.now() - s.lastFrameAt : -1, chromeMs: s.chromeMs, chromeOk: s.chromeOk, mode: s.mode, level: s.level, quality: s.quality, maxWidth: s.maxWidth, maxHeight: s.maxHeight };
    });
    return { viewers };
}
