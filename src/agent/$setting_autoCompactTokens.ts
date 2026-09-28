export default {
    type: "number",
    default: 700000,
    min: 10000,
    max: 2000000,
    title: "Auto-compaction absolute threshold",
    description: "Estimated effective-context tokens after which an idle agent is compacted automatically after a successful run.",
};
