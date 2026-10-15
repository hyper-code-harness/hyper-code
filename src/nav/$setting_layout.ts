export default {
    type: "text",
    env: "HYPER_NAV",
    default: "",
    title: "Global menu layout",
    description: "JSON {\"version\":1, \"tabs\":[{\"id\", \"title\"?, \"icon\"?, \"widgets\"?:[{\"id\",\"widget\",\"size\"?,\"config\"?}], \"search\"?:[ids]}], \"hidden\":[tab ids], \"searchHidden\":[source ids]} arranging the global menu (⌘/) for the whole instance. A person's own layout (scope user) replaces it. Tab ids: home and plugins (built-in; plugins collects plugin widgets placed nowhere) or your own; widget and search ids are <module>.<name> of $widget_ / $search_ files; unknown ids are ignored.",
};
