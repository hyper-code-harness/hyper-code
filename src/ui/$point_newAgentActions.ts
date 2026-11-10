// `ui.newAgentActions` — quick ways to start a chat besides the plain form: "New
// support chat", "Review a PR", a plugin's own wizard.
//
// Drawn on /agent/new (page and popup) above the form, and in the global menu
// (⌘/) and the Dock panel right under the "New agent" row of the Chats and
// Recent widgets.
//
// The contract:
//   - answer an array of { id, label, icon?, href? , fn? }, or [] / nothing to add
//     nothing (the normal answer); with no answers every place renders exactly
//     as before
//   - exactly one of href (a local path or http(s) URL to open) or fn (a runtime
//     function opened in the app popup, like any hx-popup) — an item with
//     neither, or with no id/label, is dropped
//   - icon is a Phosphor class (`ph-headset`); default is a plus
//   - a rejection or a timeout is logged and dropped; the others still show
// Items keep registration order; a repeated id keeps the first.
export default {
    calledWith: "{} — nothing; the action list is the same for every place it is drawn",
    answerWith: "Array<{ id: string, label: string, icon?: string, href?: string, fn?: string }> — [] to add nothing",
};
