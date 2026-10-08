export default {
    type: "boolean",
    env: "INBOX_ENABLED",
    default: false,
    title: "Inbox background sync",
    description: "Keep a long poll to the relay running in the background and deliver new mail to agents. Requires a registered key (inbox.register).",
};
