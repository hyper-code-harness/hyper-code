export default {
    type: "text",
    env: "HYPER_DOCK",
    default: "",
    title: "Dock layout",
    description: "JSON {\"top\": [ids], \"bottom\": [ids], \"hidden\": [ids]} ordering the left Dock for the whole instance. A person's own layout (scope user) replaces it. Ids are <module>.<name> of $dock_ files; unknown ids are ignored. The global menu (top) and the person (bottom) are fixed.",
};
