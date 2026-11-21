function parseJson(text: string): any {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

/** Check goal for the runtime.  * @param opts.agent Agent whose state is read or updated.
 * @param opts.candidateAnswer Candidate answer evaluated against the goal.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Live agent instance to operate on. */
    agent: types.agent.Agent;
        /** Candidate answer used by the operation. */
    candidateAnswer: string },
): Promise<{ status: "achieved" | "continue" | "blocked"; reason: string; nextStep?: string; evidence?: string[] }> {
    const goal = opts.agent.goal;
    if (!goal?.enabled || !goal?.statement) return { status: "achieved", reason: "goal disabled" };
    const messages = await ctx.fns.session.getFullMessages({ id: opts.agent.id });
    const recent = messages.slice(-30).map((m: any, i: number) => ({ index: messages.length - 30 + i, role: m.role, content: m.content }));
    // A goal is there so the agent works WITHOUT the person, so the checker has no "ask the user" verdict: it had one
    // (needs_user) and used it for work that was merely unfinished, which stopped agents at their first check.
    // What is left: reached, keep working, or truly stuck — and stuck must name what is missing.
    const system = `You are checking whether the agent has achieved its external work goal. The goal was set so that the agent works on its own, without the person. Do not solve the task. Return only JSON {status: achieved|continue|blocked, reason:string, nextStep?:string, evidence?:string[]}. Evaluate only the goal itself and actual work results. Never require a future goal-check status, an achieved card, a record of your own decision, or completion of the checking loop itself as evidence — these are self-referential internal artifacts. Use achieved when there is concrete evidence of the outcome. Use continue whenever anything is left that the agent can do or verify itself — unfinished, partial or unverified work is always continue, and nextStep says what to do next. Never stop the agent to ask the person a question, to confirm, or to choose: it decides itself and goes on. Use blocked only when no further step at all is possible without something the agent cannot obtain itself (a login or a credential only the person has, access it was denied), and name exactly what is missing in reason; if part of the work can still be done without it, that is continue. The transcript may contain earlier "Goal check" messages, also ones saying a limit or a deadline was reached: they are records of previous checks, not facts about the work. A limit reached earlier never makes the goal blocked — how many times the agent may continue is decided outside of you; judge only the work as it stands now. The agent saying "done" is not evidence by itself.`;
    try {
        const result = await ctx.fns.llm.call({
            model: opts.agent.model,
            sessionId: opts.agent.id,
            system,
            user: JSON.stringify({ goal: goal.statement, candidateAnswer: opts.candidateAnswer, recent }),
            temperature: 0,
            // The verdict is a few hundred tokens, but a reasoning model spends its thinking out of the same limit:
            // with the default 2048 the thinking took all of it and the JSON came back empty or cut off
            // ("goal checker failed: JSON Parse error: Unexpected EOF", 2026-11-16).
            max_tokens: 8192,
        });
        const parsed = parseJson(result.text);
        // A model that still answers "needs_user" (the verdict this checker used to have) means "not finished": go on.
        const status = parsed?.status === "needs_user" ? "continue" : ["achieved", "continue", "blocked"].includes(parsed?.status) ? parsed.status : "blocked";
        return { status, reason: String(parsed?.reason ?? "No reason provided").slice(0, 1000), nextStep: parsed?.nextStep ? String(parsed.nextStep).slice(0, 1000) : undefined, evidence: Array.isArray(parsed?.evidence) ? parsed.evidence.map(String).slice(0, 10) : [] };
    } catch (error: any) {
        return { status: "blocked", reason: `goal checker failed: ${error?.message ?? error}` };
    }
}
