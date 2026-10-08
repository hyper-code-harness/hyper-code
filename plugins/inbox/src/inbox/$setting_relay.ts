export default {
    type: "string",
    env: "INBOX_RELAY",
    default: "",
    title: "Inbox relay",
    description: "Relay origin, for example https://control.hn.hyper-mesh.xyz. Empty: derived from the Hyperlet agent config of this machine.",
};
