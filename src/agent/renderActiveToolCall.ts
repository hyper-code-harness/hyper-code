// The "I am not hung, I am waiting" indicator — one turning circle.
//
// The incident (agent cbad, 2026-10-01): a signed-build script sat inside
// `notarytool submit --wait` for 30+ minutes. The last thing in the chat was a
// sentence of prose, so the UI looked dead; the user wrote "ау", "в чем дело?"
// and those messages queued silently. The database knew the truth the whole
// time — run_state='running', a fresh heartbeat — it simply was not on screen.
//
// It is the SAME round chip a finished tool call wears, with a spinning ring
// around it. That is the whole idea: the thing that will become a tool chip is
// already that chip, it is simply still turning, and it keeps its place in the
// row of calls instead of pushing the conversation down with a panel. The
// details a waiting person actually asks for — how long, against what limit,
// what has it printed, how do I stop it — live one click away in the same
// popup that opens for a finished call, because that is where the reader has
// already learned to look.
/**
 * Renders the live chip for an agent's currently executing tool call.
 *
 * Use as a chat live region so a long tool call shows a spinning tool chip that opens the running call's details popup; returns an empty string when nothing is running.
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
    // Longest-running first: that is the call a waiting user is blocked on.
    const run = ctx.fns.tools.runs({ agentId: opts.agentId })[0];
    if (!run) return "";

    const label = `${run.name} ${run.subject}`.trim();
    // The hover text says it is running and for how long even before the click,
    // so the cheapest possible check — point at it — already answers "alive?".
    const title = `${label} — running, click for details`;

    // A ring that turns on top of the chip's own border, not a second widget
    // beside it: one shape to learn, and the eye follows motion by itself.
    // The arc inside it fills toward the call's own timeout, so a glance also
    // answers "how much of the allowed wait is gone" without opening anything.
    const chip = ctx.fns.agent.toolSpinner({
        icon: run.icon,
        startedAt: run.startedAt,
        timeoutMs: run.timeoutMs,
    });

    return ctx.fns.ui.popup({
        method: "agent.activeToolDetails",
        params: { agentId: opts.agentId },
        html: chip,
        attrs: `class="tool tool-tucked relative shrink-0 rounded-full border-0 bg-info/10 text-info"`
            + ` data-tool="${esc(run.name)}" data-tool-running="1" data-title="${esc(label)}"`
            + ` title="${esc(title)}" aria-label="${esc(title)}" aria-busy="true"`,
    });
}
