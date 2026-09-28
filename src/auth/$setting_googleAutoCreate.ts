export default {
    type: "boolean",
    env: "HYPER_GOOGLE_AUTO_CREATE",
    default: true,
    title: "Create users on first Google sign-in",
    description: "When on, a verified account of the allowed domain gets a member user on first sign-in. When off, only users already added (by email) can sign in with Google.",
};
