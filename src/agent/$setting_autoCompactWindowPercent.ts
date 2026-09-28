export default {
    type: "number",
    default: 80,
    min: 30,
    max: 95,
    title: "Auto-compaction at % of model window",
    description: "An idle agent is compacted automatically after a run once its context exceeds this percentage of the model's context window (Claude 200K, Codex 272K). The lower of this and autoCompactTokens wins.",
};
