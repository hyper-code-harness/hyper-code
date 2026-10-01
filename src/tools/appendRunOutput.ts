// Feed partial output into a running call so the chat can show a live tail.
//
// The incident had a second half: the command piped through `tail -8`, so even
// the output that did exist was buffered until the process ended. Streaming
// what the tool has produced SO FAR is the only honest answer to "is it
// alive?" — a changing last line proves progress in a way a spinner cannot.
//
// Only the tail is kept. This is a liveness display, not a log: the full
// output still arrives as the tool result.
const MAX_TAIL = 4000;

/**
 * Appends streamed output to a running tool call's visible tail.
 *
 * Use from a long-running tool that produces incremental stdout or stderr so the chat shows live progress; only the last few kilobytes are retained.
 * @param opts.id Execution id returned by tools.beginRun.
 * @param opts.chunk Newly produced output text to append.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Execution id returned by tools.beginRun. */
        id: string;
        /** Newly produced output text to append. */
        chunk: string;
    },
): { appended: boolean } {
    const registry: Map<string, types.tools.ToolRun> = ((ctx.state as any).toolRuns ??= new Map());
    const run = registry.get(opts.id);
    if (!run || !opts.chunk) return { appended: false };
    const next = run.tail + String(opts.chunk);
    run.tail = next.length > MAX_TAIL ? next.slice(next.length - MAX_TAIL) : next;
    return { appended: true };
}
