export default {
    type: "boolean",
    env: "HYPER_TOOLS_ENFORCE_ALLOWLIST",
    default: false,
    title: "Refuse tools outside the agent's tool list",
    description: "When off, tools.call only logs a warning when an agent with a tool list calls a tool it did not list (or an opt-in tool it did not name). When on, such a call is refused with an error the model sees.",
};
