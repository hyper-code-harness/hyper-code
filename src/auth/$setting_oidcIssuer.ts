export default {
    type: "string",
    env: "HYPER_OIDC_ISSUER",
    default: null,
    title: "Sign-in provider (OIDC issuer)",
    description: "Base URL of the Hyper Control Plane (or any OpenID Connect provider). Sign-in through it stays off until issuer, client ID and client secret are all set. Password sign-in keeps working.",
};
