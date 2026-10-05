// `agent.promptAugment` — one more block of context for this turn, from
// whoever has something relevant to say.
//
// Anything that wants a word in the prompt — procedural memory, project
// conventions, a patient banner — must not need a core edit to get one.
//
// Answers are collected by agent.syncWorldState and appended as a persisted,
// cursor-excluded `world_state` row at the TAIL of the transcript, after the
// user's own words. They are NOT spliced into the user's message: a block that
// changes between requests would rewrite history the provider has already
// cached, and the transcript would disagree with what the model saw.
//
// The contract is narrow on purpose, because this is the most dangerous thing
// a plugin can do to a model:
//   - return "" (or nothing) to stay out; most turns should
//   - return self-contained text, already delimited, already saying what it is;
//     the caller only concatenates
//   - a rejection or a timeout is ignored and logged: a turn still happens
//   - the same text on the next turn is sent ONCE: the row is only appended
//     when the block actually changed
// Answers are appended in registration order.
export default {
    calledWith: "{ agentId: string, text: string } — the latest user message, verbatim",
    answerWith: "string — a delimited block to add to this turn, or \"\" to add nothing",
};
