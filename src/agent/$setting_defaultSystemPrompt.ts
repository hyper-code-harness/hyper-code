export default {
    type: "string",
    default: "full",
    title: "Default system prompt",
    description: "Name of the system prompt a new chat gets when nobody picks one: a built-in (full — the complete prompt, lean — the short one with the handbook) or a saved one (agent.systemPrompts). A person's last pick in the New agent form wins over this for that person.",
};
