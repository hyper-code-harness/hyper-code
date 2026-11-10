// `agent.basePrompt` — replace the BASE of an agent's system prompt (layer 1 in
// agent.fullSystemPrompt: what agent.systemPromptBase would pick by name).
//
// For a plugin that runs agents with a different persona or job — a support bot,
// a reviewer profile — chosen per agent by what it keeps in agent.meta.
//
// The contract:
//   - return null (or nothing) to stay out; that is the normal answer, and with
//     no answer the prompt is byte-for-byte what it was
//   - the first non-null answer wins (registration order); an empty string is a
//     real answer (an empty base)
//   - only the base is replaced: the tool section, fences, plugins, per-agent
//     agent.systemPrompt and the runtime context are still appended after it
//   - a rejection or a timeout is logged and skipped, the next handler is asked
//   - answer from things that do not change within a session (agent.meta): the
//     system prompt is the cached prefix of every request
export default {
    calledWith: "{ agentId: string, meta: Record<string, any> | null } — the agent and its agent.meta",
    answerWith: "string — the whole base system prompt to use instead of the named one, or null to stay out",
};
