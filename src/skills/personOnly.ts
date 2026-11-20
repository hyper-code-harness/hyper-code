/**
 * Refuses a skills change when the call comes from an agent rather than from a person
 *
 * Use at the top of whatever installs, removes or widens skills. An agent may look for skills and propose them
 * (skills.hubSearch, skills.propose); the decision is the person's, taken in the chat form or on the Skills page, so
 * a skill's text — or anything else an agent read — cannot talk the agent into installing or enabling skills by
 * itself. Calls with an agent session (the `skill` tool, eval, a background eval) are refused; calls with no session
 * or with a person's HTTP session pass. This is a guard rail, not a sandbox: an agent with bash can still change
 * files on the machine.
 * @param opts.what What is being attempted, for the error text, e.g. "install a skill pack".
 */
export default function (_ctx: Context, session: Session | null, opts: {
    /** What is being attempted, for the error text, e.g. "install a skill pack". */
    what: string;
}): void {
    if (session?.kind === "agent" || session?.agentId || session?.agent)
        throw new Error(`An agent cannot ${opts.what} by itself: propose it with ctx.fns.skills.propose({ repo, select }) and the person decides in the chat form.`);
}
