export default {
    type: "secret",
    env: "HYPER_LLM_PROXY_TOKEN",
    default: null,
    title: "LLM proxy token",
    description: "Bearer token another Hyper instance must present to relay Anthropic requests through this instance's Claude subscription (POST /llm/proxy/anthropic/v1/messages). Empty disables the proxy.",
};
