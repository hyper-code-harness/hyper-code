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
    const w = ctx.fns.w;
    const id = String(opts.agentId ?? "");
    const run = ctx.fns.tools.runs({ agentId: id })[0];
    const caption = (icon: string, text: string) => w.box({ body: w.icon({ name: icon, size: 12 }) + w.escape({ text }), mix: { layout: "row", gap: "s2", caption: true } });

    const body = run ? renderRunning() : renderFinished();

    function renderFinished(): string {
        // Not an error: the call ended while the popup was open. Say so plainly
        // instead of leaving the last tail on screen looking still-alive.
        return w.eventNote({ text: "The call has finished — its result is in the chat.", icon: "check-circle", tone: "success" });
    }

    function renderRunning(): string {
        const r = run!;
        const deadline = r.timeoutMs ? r.startedAt + r.timeoutMs : undefined;
        // Seconds are counted client-side (ui/tool-timer.js): a label rendered
        // server-side would cost one request per second per open tab to say
        // something the browser already knows.
        const timer = w.timer({ since: r.startedAt, deadline, format: "clock" });

        const stop = w.button({
            label: r.aborted ? "Stopping…" : `Stop this ${r.name} call`,
            tone: r.aborted ? "neutral" : "danger",
            size: "sm",
            marks: { action: "abort-tool-call" },
            title: "Stop only this call — the agent continues and reads your messages",
            disabled: r.aborted,
            action: r.aborted ? undefined : { post: `/agent/${encodeURIComponent(id)}/tool/${encodeURIComponent(r.id)}/abort`, swap: "none" },
        });

        const toBackground = r.detachable && !r.aborted
            ? w.button({ label: "To background", size: "sm", action: { post: `/agent/${encodeURIComponent(id)}/tool/${encodeURIComponent(r.id)}/detach`, swap: "none" }, marks: { action: "detach-tool-call" }, title: "Stop waiting: the command keeps running as a background job and the agent is told when it ends" })
            : "";

        const tail = r.tail.trimEnd();
        // Last lines only: this is a liveness display, not a log. The full
        // output arrives as the tool result.
        const lines = tail ? tail.split("\n").slice(-14) : [];
        const tailHtml = lines.length
            ? w.box({ body: w.escape({ text: lines.join("\n") }), mix: { mono: true, text: "small", ink: "muted", pad: "s3", radius: "item", line: "around", pre: true } })
            // A changing last line is the only proof of progress a stuck
            // process cannot fake; its absence is worth stating, not hiding.
            : w.box({ body: "No output yet.", mix: { text: "small", ink: "faint", pad: "s3", radius: "item", line: "around" } });

        const icon = String(r.icon ?? "terminal").replace(/^ph-/, "");
        const head = w.box({
            body: w.spinner({ kind: "glow", html: w.icon({ name: icon, size: 16, tone: "info" }) })
                + w.box({ body: w.escape({ text: r.name }), mix: { weight: "strong" }, tag: "span" })
                + timer
                + w.box({ body: toBackground + stop, mix: { layout: "row", gap: "s2", end: true }, tag: "span" }),
            mix: { layout: "row", gap: "s2", wrap: true },
        });
        return w.box({
            body: head
                + (r.subject ? w.box({ body: w.escape({ text: r.subject }), mix: { mono: true, text: "small", ink: "muted", pre: true } }) : "")
                + w.box({ body: caption("arrow-left", "Output so far") + tailHtml, mix: { layout: "stack", gap: "s1" }, tag: "section" }),
            mix: { layout: "stack", gap: "s3" },
        });
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
