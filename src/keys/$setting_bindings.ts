export default {
    type: "json",
    default: {},
    title: "Personal key bindings",
    description: 'Overrides on top of the chosen keymap: { "<keys>": "<command id>" } binds, null unbinds. Keys use CodeMirror spelling: Ctrl-, Alt-, Shift-, Meta-, Mod- (⌘ on a Mac, Ctrl elsewhere), a space between the steps of a sequence. A key of a named scope is written "<scope>:<keys>". Example: { "Ctrl-x b": "nav.open", "Mod-b": null, "menu:Ctrl-n": "menu.next" }.',
};
