// `agent.promptAugment` — one more block to append to the last user message,
// from whoever has something relevant to this turn.
//
// The framework already does this for runtime functions (the `functionRag`
// block) because the function catalogue is the framework's own. Anything else
// that wants a word in the prompt — procedural memory, project conventions, a
// patient banner — is not, and must not need a core edit to get one.
//
// The contract is narrow on purpose, because this is the most dangerous thing
// a plugin can do to a model:
//   - return "" (or nothing) to stay out; most turns should
//   - return self-contained text, already delimited, already saying what it is;
//     the caller only concatenates
//   - a rejection or a timeout is ignored and logged: a turn still happens
// Answers are appended in registration order after the user's own words.
export default {
    calledWith: "{ agentId: string, text: string } — the latest user message, verbatim",
    answerWith: "string — a delimited block to append, or \"\" to add nothing",
};
