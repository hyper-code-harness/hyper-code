export default {
    type: "string",
    env: "HYPER_PORTAL_AUDIENCE",
    default: null,
    title: "Portal assertion audience",
    description: "The aud this Hyper expects in the hub's X-Hn-Assertion, hn:<team>/<node>/<service>, e.g. hn:hr/studio/hyper. Assertions for any other service are ignored.",
};
