export default {
    type: "string",
    env: "LOCALIZATION_MODEL",
    default: "google/gemma-4-31b",
    title: "Localization model",
    description: "Model used by the nightly retrieval-text localization pass. Kept separate from the default chat model so background indexing never loads a large one.",
};
