export default {
    type: "string",
    env: "INBOX_HOST",
    default: "",
    title: "Inbox address host",
    description: "Published Hyper host whose addresses this instance owns, for example hyper.hr.in.hn.hyper-mesh.xyz; agents get <agent id>@host. Empty: derived from the Hyperlet config (its service of kind hyper).",
};
