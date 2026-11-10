export default {
    type: "boolean",
    default: false,
    title: "Check allowed HTTP hosts",
    description: "Opt in to exact hostname allowlisting via http.allowedHosts. Disabled by default: domain restrictions and DNS rebinding protection are not enforced. Origin/Referer checks and loopback-only setup remain enabled independently.",
};
