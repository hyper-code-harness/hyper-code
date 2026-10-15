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
): Promise<{ status: "achieved" | "continue" | "needs_user" | "blocked"; reason: string; nextStep?: string; evidence?: string[] }> {
    const goal = opts.agent.goal;
    if (!goal?.enabled || !goal?.statement) return { status: "achieved", reason: "goal disabled" };
    const messages = await ctx.fns.session.getFullMessages({ id: opts.agent.id });
    const recent = messages.slice(-30).map((m: any, i: number) => ({ index: messages.length - 30 + i, role: m.role, content: m.content }));
    const system = `You are checking whether the agent has achieved its external work goal. Do not solve the task. Return only JSON {status: achieved|continue|needs_user|blocked, reason:string, nextStep?:string, evidence?:string[]}. Evaluate only the goal itself and actual work results. Never require a future goal-check status, an achieved card, a record of your own decision, or completion of the checking loop itself as evidence — these are self-referential internal artifacts. Use achieved when there is concrete evidence of the outcome. Use continue if the agent can take the next work step independently. Use needs_user if a user response or choice is needed. Use blocked if continuing is impossible. The agent saying "done" is not evidence by itself.`;
    try {
        const result = await ctx.fns.llm.call({
            model: opts.agent.model,
            sessionId: opts.agent.id,
            system,
            user: JSON.stringify({ goal: goal.statement, candidateAnswer: opts.candidateAnswer, recent }),
            temperature: 0,
        });
        const parsed = parseJson(result.text);
        const status = ["achieved", "continue", "needs_user", "blocked"].includes(parsed?.status) ? parsed.status : "blocked";
        return { status, reason: String(parsed?.reason ?? "No reason provided").slice(0, 1000), nextStep: parsed?.nextStep ? String(parsed.nextStep).slice(0, 1000) : undefined, evidence: Array.isArray(parsed?.evidence) ? parsed.evidence.map(String).slice(0, 10) : [] };
    } catch (error: any) {
        return { status: "blocked", reason: `goal checker failed: ${error?.message ?? error}` };
    }
}
