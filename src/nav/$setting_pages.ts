export default {
    type: "json",
    title: "Menu pages",
    description: "Ordered list of page ids (the <name> of $app_<name>.json, e.g. [\"search\",\"settings\",\"plugins\"]) that the Pages widget of the global menu (⌘/) shows, in this order. Not set: every core page, by its declared order. [] shows none. Unknown ids are skipped, so a disabled plugin never breaks the list. Hiding a page does not block access to it. Usually set for the instance in ~/.hyper/settings/$settings_nav.json.",
};
