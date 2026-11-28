/** Route every local Claude subscription request, including inbound Hyper relay, through one shared managed account. */
export default {
    type: "boolean",
    default: false,
    title: "Shared Claude subscription pool",
    description: "Use one sticky current managed Claude account for all claude-code and anthropic-oauth models, including explicitly named accounts and incoming Hyper relay requests. Preserve the model; switch only when subscription quota is exhausted. Disabled by default; API-key Anthropic and chained Hyper routes are unchanged.",
};
