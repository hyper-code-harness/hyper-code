// The "I am not hung, I am waiting" card.
//
// The incident (agent cbad, 2026-10-01): a signed-build script sat inside
// `notarytool submit --wait` for 30+ minutes. The last thing in the chat was a
// sentence of prose, so the UI looked dead; the user wrote "ау", "в чем дело?"
// and those messages queued silently. The database knew the truth the whole
// time — run_state='running', a fresh heartbeat — it simply was not on screen.
//
// Three things make this card honest, and each is here for a reason:
//   - a SPINNER, because a static label cannot be told apart from a frozen page
//   - the ELAPSED time against the declared timeout, because "27 of 30 min"
//     answers "should I keep waiting?" in a way "running" never does
//   - the OUTPUT TAIL, because a changing last line is the only proof of
//     progress that a stuck process cannot fake
//
// The timer text is rendered as a data attribute and animated client-side
// (ui/tool-timer.js). Counting seconds on the server would mean an HTTP
// request per second per open tab to display something the browser can compute.
/**
 * Renders the live indicator for an agent's currently executing tool call.
 *
 * Use as a chat live region so a long tool call shows a spinner, elapsed time against its timeout, streamed output tail and an abort control; returns an empty string when nothing is running.
 * @param opts.agentId Agent whose running tool call should be rendered.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose running tool call should be rendered. */
        agentId: string;
    },
): string {
    const esc = (value: any) => ctx.fns.procs.ui.escape({ text: value });
    // The newest call is the one the user is waiting on. Parallel calls in one
    // reply are rare and short; the long one is what needs explaining.
    const run = ctx.fns.tools.runs({ agentId: opts.agentId })[0];
    if (!run) return "";

    const deadline = run.timeoutMs ? run.startedAt + run.timeoutMs : null;
    const tail = run.tail.trimEnd();
    // Last lines only, and the last lines are the interesting ones: this is a
    // liveness display, not a log. The full output arrives as the tool result.
    const lines = tail ? tail.split("\n").slice(-8) : [];

    const timer = `<span class="tool-timer font-mono text-2xs text-info"`
        + ` data-tool-started-at="${run.startedAt}"`
        + (deadline ? ` data-tool-deadline="${deadline}"` : "")
        + `>…</span>`;

    // The running call wears the SAME round chip as a finished tool call, with
    // a spinning ring around it. That is the point: the thing that will become
    // a tool chip is already a tool chip, it is simply still turning. A
    // separate spinner widget would read as a different kind of object and the
    // eye would have to learn two shapes for one fact.
    const chip = `<span class="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-info/50 bg-base-100/70">`
        + `<span class="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-info" aria-hidden="true"></span>`
        + `<i class="ph ph-${esc(run.icon)} text-info" aria-hidden="true"></i>`
        + `</span>`;

    const abort = ctx.fns.procs.ui.button({
        action: "abort-tool-call",
        label: run.aborted ? "Stopping…" : "Stop",
        size: "xs",
        class: "shrink-0 rounded-full",
        title: `Stop this ${run.name} call and let the agent continue`,
        disabled: run.aborted,
        ...(run.aborted ? {} : {
            post: `/agent/${encodeURIComponent(opts.agentId)}/tool/${encodeURIComponent(run.id)}/abort`,
            swap: "none",
        }),
    });

    const tailHtml = lines.length
        ? `<pre class="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-ui-border bg-base-100/70 p-2 font-mono text-3xs leading-4 text-muted">${esc(lines.join("\n"))}</pre>`
        : "";

    return `<div class="w-full overflow-hidden rounded-lg border border-info/45 bg-info/10">
  <div class="flex items-start gap-2 px-3 py-2">
    ${chip}
    <div class="min-w-0 flex-1">
      <div class="flex min-h-7 items-center gap-2">
        <span class="shrink-0 text-xs font-semibold">${esc(run.name)}</span>
        ${timer}
        <span class="ml-auto shrink-0">${abort}</span>
      </div>
      <div class="mt-1 truncate font-mono text-2xs text-muted" title="${esc(run.subject)}">${esc(run.subject)}</div>
      ${tailHtml}
    </div>
  </div>
</div>`;
}
