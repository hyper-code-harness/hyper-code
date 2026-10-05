// `session.taskDone` — a plan task was just closed by `session.done`.
//
// The one moment in an agent's life when "a unit of work ended" is known for
// free, rather than guessed: the agent itself said so. That makes it the
// natural place to harvest anything that should outlive the transcript —
// procedural memory, metrics, a notification.
//
// Answers are fired and forgotten: the task is already done, and a handler
// that is slow (an LLM round trip) or broken must not fail the closing, so
// nothing here can change the result `done` returns. Report problems by
// logging them.
export default {
    calledWith: "{ agentId: string, taskId: string, taskTitle: string, elapsedMs?: number, complete: boolean, next: string | null }",
    answerWith: "void — the result is ignored, and so is a rejection",
};
