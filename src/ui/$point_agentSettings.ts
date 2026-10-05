// `ui.agentSettings` — one more row of controls in the Agent settings section
// of the inspector.
//
// The toggles the framework ships there (function retrieval, its gate, the
// reranker) are the framework's own state, read straight off the agent row.
// Anything a plugin wants switched — procedural memory, a project convention
// pack — is not, and must not need an edit to `ui.agentMetaSection` to get a
// switch the user can reach.
//
// The contract:
//   - answer with self-contained HTML: a plugin's own <form hx-post> to its own
//     route, so the framework never learns what the setting means or how to
//     persist it; posting and re-rendering are the plugin's business
//   - answer "" to add nothing, which is the normal answer
//   - a rejection or a timeout is logged and dropped: the panel still renders
//
// Answers are appended after the framework's own toggles, in registration
// order. The section is rendered synchronously, so the collecting happens in
// the route and the RPC redraw and arrives here as plain strings.
export default {
    calledWith: "{ agentId: string } — the agent whose inspector is being drawn",
    answerWith: "html for a row of controls, or \"\" to add nothing",
};
