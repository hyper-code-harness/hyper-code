export default {
    type: "string",
    env: "INBOX_PRINCIPAL",
    default: "",
    title: "Inbox node principal",
    description: "Mesh identity the key is bound as, spiffe://hn/<tenant>/<node>. Empty: derived from the Hyperlet config.",
};
