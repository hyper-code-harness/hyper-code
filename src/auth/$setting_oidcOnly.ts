export default {
    type: "boolean",
    env: "HYPER_OIDC_ONLY",
    default: false,
    title: "Sign in only through the control plane",
    description: "When on, the only way in is 'Sign in with <provider>' (OIDC): no password form, no first-user setup, no open instance, and password or legacy sessions are not accepted.",
};
