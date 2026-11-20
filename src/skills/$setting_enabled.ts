export default {
    type: "boolean",
    env: "SKILLS_ENABLED",
    default: false,
    title: "Agent Skills for every agent",
    description: "When on, every agent without a tool list of its own gets the `skill` tool and the system-prompt section about plugins and skills. When off, only agents that name `skill` in their tool list have them. Change it with the button on the Skills page (skills.setEnabled): turning it on moves the cached prompt prefix of every live session once.",
};
