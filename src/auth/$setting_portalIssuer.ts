export default {
    type: "string",
    env: "HYPER_PORTAL_ISSUER",
    default: "https://hn.hyper-mesh.xyz",
    title: "Portal assertion issuer",
    description: "Issuer of the hub's X-Hn-Assertion; its signing keys come from <issuer>/.well-known/openid-configuration jwks_uri.",
};
