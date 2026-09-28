export default {
    type: "string",
    env: "HYPER_GOOGLE_DOMAIN",
    default: "health-samurai.io",
    title: "Google sign-in allowed domain",
    description: "Only Google Workspace accounts of this domain may sign in (checked on the verified hd and email claims).",
};
