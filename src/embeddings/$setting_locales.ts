export default {
    type: "string",
    env: "EMBEDDINGS_LOCALES",
    default: "",
    title: "Retrieval locales",
    description: "Comma-separated locales (for example ru) for which an LLM writes translated retrieval text at indexing time, for multilingual BM25 and semantic retrieval. Empty (the default) turns translation off: no LLM calls, English-only index.",
};
