// One tool call that is RUNNING RIGHT NOW.
//
// The incident this exists for: a bash call sat inside `notarytool --wait` for
// 30+ minutes. run_state was 'running' and the heartbeat was fresh, so the
// system knew perfectly well that work was happening — it just never said so.
// The last thing on screen was a sentence of prose, and the user concluded the
// agent had hung.
//
// The entry lives only in memory (ctx.state.toolRuns) and only for the
// duration of the call. It is deliberately NOT persisted: a run that did not
// survive a restart is not running, and a stale row claiming otherwise would
// be the same lie in a new place.
export type ToolRun = {
    /** Unique id of this execution, used by the abort route. */
    id: string;
    /** Agent the call belongs to; empty when a tool is invoked outside a run. */
    agentId: string;
    /** Wire name of the tool, e.g. "bash". */
    name: string;
    /** Short human subject of the call — the command, the path, the pattern. */
    subject: string;
    /** Phosphor icon name for the tool. */
    icon: string;
    /** Epoch ms when execution began. */
    startedAt: number;
    /** Declared deadline in ms, when the tool takes a timeout; null when open-ended. */
    timeoutMs: number | null;
    /** Most recent output the tool has streamed so far (bash stdout/stderr tail). */
    tail: string;
    /** Set once the user asks for this call to stop. */
    aborted: boolean;
    /** Cancels the call; bash kills the process, other tools stop being awaited. */
    controller: AbortController;
};
