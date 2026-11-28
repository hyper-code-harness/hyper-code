export default {
    type: "boolean",
    default: false,
    title: "Record LLM usage",
    description: "Enable the metadata-only LLM call and attempt ledger after its schema migration has been explicitly applied. Disabled by default; provider requests continue normally when accounting fails. Does not estimate token usage or monetary costs.",
};
