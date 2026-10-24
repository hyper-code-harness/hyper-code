export default {
    type: "text",
    env: "HYPER_DOCK_PANEL",
    default: "",
    title: "Dock side panel widgets",
    description: "JSON {\"widgets\": [{\"id\", \"widget\", \"config\"?}]} — the global-menu widgets ($widget_ ids such as recent, chats, projects, inbox.unread) shown in the side panel beside the Dock, top to bottom. A person's own list (scope user) replaces the instance one; with neither, the panel shows Recent by project (20 chats). Edited from the panel's pencil button.",
};
