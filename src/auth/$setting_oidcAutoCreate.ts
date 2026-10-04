export default {
    type: "boolean",
    env: "HYPER_OIDC_AUTO_CREATE",
    default: true,
    title: "Create users on first control-plane sign-in",
    description: "When on, anyone the OIDC provider vouches for gets a member user on first sign-in. When off, only users already added here (matched by email) can sign in through the provider.",
};
