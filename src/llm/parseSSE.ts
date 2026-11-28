// Shared Server-Sent-Events frame parser for every LLM stream path
// (streamOpenAI / streamAnthropic / streamCodex). Splits the byte stream on
// blank-line frame boundaries and yields one frame at a time as
// { event, data }, where:
//   - event = the last `event:` line's value, or null if the frame had none
//   - data  = all `data:` lines joined by "\n", each with a single leading
//             space stripped (SSE spec). Handles both "data: x" (OpenAI/
//             Anthropic) and "data:x" (Kimi omits the space).
// Callers do their own JSON.parse / [DONE] / event-dispatch — this only frames.
// Frames with no `data:` line (comments, keepalives) are skipped.
// A stalled stream (connection wedged, provider gone quiet) used to hold the
// agent's run forever — 141s of silence looked like a hang to the user. If no
// chunk arrives within idleTimeoutMs (default 120s) the generator throws; the
// run errors out, the statusbar shows it, the next message retries.
/**
 * Parse provider SSE frames and release the response stream when consumption ends.
 *
 * Use for native model streams. Consumer breaks, callback errors and idle
 * timeouts cancel an unfinished body so transports and accounting can settle.
 * @param opts.body Response byte stream or notification body.
 * @param opts.idleTimeoutMs Maximum wait between stream chunks in milliseconds.
 */
export default async function* (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider response byte stream; owned until EOF or consumer cancellation. */ body: ReadableStream<Uint8Array>;
        /** Maximum quiet interval between chunks in milliseconds. @default 120000 */ idleTimeoutMs?: number },
): AsyncGenerator<{ event: string | null; data: string }> {
    const idleMs = opts.idleTimeoutMs ?? 120_000;
    const decoder = new TextDecoder();
    let buf = "";
    const reader = opts.body.getReader();
    let finished = false;
    try {
        while (true) {
            let timer: any;
            const stall = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`stream stalled — no data for ${Math.round(idleMs / 1000)}s`)), idleMs);
            });
            let done: boolean, chunk: Uint8Array | undefined;
            try {
                ({ done, value: chunk } = await Promise.race([reader.read(), stall]) as any);
            } finally {
                clearTimeout(timer);
            }
            if (done) { finished = true; break; }
            if (!chunk) continue;
            buf += decoder.decode(chunk, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
                const raw = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                let event: string | null = null;
                const dataLines: string[] = [];
                for (const line of raw.split("\n")) {
                    if (line.startsWith("event:")) event = line.slice(6).trim();
                    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
                }
                if (dataLines.length) yield { event, data: dataLines.join("\n") };
            }
        }
    } finally {
        // An early consumer exit must reach the underlying response observer.
        // Preserve the original parser/consumer error if cancellation rejects.
        if (!finished) {
            try { await reader.cancel(); }
            catch { console.warn("[llm.parseSSE] stream cancellation failed"); }
        }
        reader.releaseLock();
    }
}
