export default {
    type: "string",
    env: "INBOX_DEFAULT_AGENT",
    default: "",
    title: "Inbox default agent",
    description: "Agent id that receives mail to inbox@host and to unknown local parts. Empty: such mail is stored and shown in /inbox, no agent is woken.",
};
