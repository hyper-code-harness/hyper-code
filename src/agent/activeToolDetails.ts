// The body behind the spinning chip: the four things a waiting person asks.
//
// "What is it doing", "how long has it been", "is it still moving", "how do I
// stop it". A finished call answers these from the transcript (agent.toolDetails);
// a running one has no transcript row yet, so it answers from the live registry
// and wears the same popup shell, so the reader learns one place, not two.
//
// It is a live region itself: the popup stays open while the call runs, and a
// tail that froze the moment it opened would be indistinguishable from a tail
// that stopped because the process died — the exact confusion this feature
// exists to remove.
/**
 * Renders popup details for an agent's currently executing tool call.
 *
 * Use as the popup body behind the live tool chip to show elapsed time against the declared timeout, the streamed output tail and an abort control; reports completion once the call is no longer running.
 * @param opts.agentId Agent whose running tool call should be described.
 * @param opts.bodyOnly Return just the refreshing inner body, without the popup shell, for the live region's own polls.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose running tool call should be described. */
        agentId: string;
        /** Return just the refreshing inner body, without the popup shell, for the live region's own polls. */
        bodyOnly?: boolean;
    },
): Response {
    const esc = (value: any) => ctx.fns.procs.ui.escape({ text: value });
    const id = String(opts.agentId ?? "");
    const run = ctx.fns.tools.runs({ agentId: id })[0];

    const body = run ? renderRunning() : renderFinished();

    function renderFinished(): string {
        // Not an error: the call ended while the popup was open. Say so plainly
        // instead of leaving the last tail on screen looking still-alive.
        return `<div class="flex items-center gap-2 text-xs text-muted">`
            + `<i class="ph ph-check-circle text-success" aria-hidden="true"></i>`
            + `<span>The call has finished — its result is in the chat.</span></div>`;
    }

    function renderRunning(): string {
        const r = run!;
        const deadline = r.timeoutMs ? r.startedAt + r.timeoutMs : null;
        // Seconds are counted client-side (ui/tool-timer.js): a label rendered
        // server-side would cost one request per second per open tab to say
        // something the browser already knows.
        const timer = `<span class="tool-timer font-mono text-xs text-info"`
            + ` data-tool-started-at="${r.startedAt}"`
            + (deadline ? ` data-tool-deadline="${deadline}"` : "")
            + `>…</span>`;

        const stop = ctx.fns.procs.ui.button({
            action: "abort-tool-call",
            label: r.aborted ? "Stopping…" : `Stop this ${r.name} call`,
            tone: r.aborted ? undefined : "danger",
            size: "xs",
            class: "rounded-full",
            title: "Stop only this call — the agent continues and reads your messages",
            disabled: r.aborted,
            ...(r.aborted ? {} : {
                post: `/agent/${encodeURIComponent(id)}/tool/${encodeURIComponent(r.id)}/abort`,
                swap: "none",
            }),
        });

        const tail = r.tail.trimEnd();
        // Last lines only: this is a liveness display, not a log. The full
        // output arrives as the tool result.
        const lines = tail ? tail.split("\n").slice(-14) : [];
        const tailHtml = lines.length
            ? `<pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ui-border bg-base-100 px-3 py-2 font-mono text-2xs leading-5 text-muted">${esc(lines.join("\n"))}</pre>`
            // A changing last line is the only proof of progress a stuck
            // process cannot fake; its absence is worth stating, not hiding.
            : `<div class="rounded-lg border border-ui-border bg-base-100 px-3 py-2 text-2xs text-faint">No output yet.</div>`;

        return `<div class="flex flex-wrap items-center gap-2">`
            + `<span class="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-info/60 bg-info/10">`
            + `<span class="absolute -inset-0.5 animate-spin rounded-full border-2 border-transparent border-t-info border-r-info/40" aria-hidden="true"></span>`
            + `<i class="ph ph-${esc(r.icon)} text-info text-xs" aria-hidden="true"></i></span>`
            + `<span class="text-xs font-semibold">${esc(r.name)}</span>${timer}`
            + `<span class="ml-auto">${stop}</span></div>`
            + (r.subject ? `<div class="mt-2 break-words font-mono text-2xs text-muted">${esc(r.subject)}</div>` : "")
            + `<section class="mt-3"><div class="mb-1 flex items-center gap-2 text-3xs font-semibold uppercase tracking-wide text-faint">`
            + `<i class="ph ph-arrow-left" aria-hidden="true"></i> Output so far</div>${tailHtml}</section>`;
    }

    const headers = { "content-type": "text/html; charset=utf-8" };
    // The live region re-fetches this same handler, so its polls must return
    // the body alone — wrapping the shell again would nest one popup inside
    // another on every tick.
    if (opts.bodyOnly) return new Response(body, { headers });

    // Keeps itself current while open, on the same topic the chat already
    // publishes when a run starts, streams or ends.
    const live = ctx.fns.ui.live({
        id: `active-tool-details-${id}`,
        url: `/agent/${encodeURIComponent(id)}/active-tool-details?body=1`,
        topic: `agent:${id}`,
        every: 5,
        swap: "innerHTML",
        html: body,
    });

    return new Response(
        ctx.fns.ui.popupContent({ title: run ? `${run.name} · running` : "Tool call", kind: "tool", html: live }),
        { headers },
    );
}
