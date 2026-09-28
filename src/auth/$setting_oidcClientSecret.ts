export default {
    type: "secret",
    env: "HYPER_OIDC_CLIENT_SECRET",
    default: null,
    title: "Sign-in provider client secret",
    description: "OIDC client secret for this Hyper. May be an op:// or secret:// reference.",
};
