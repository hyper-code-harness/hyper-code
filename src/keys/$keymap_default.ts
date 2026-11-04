// The harness's own shortcuts. Keys use CodeMirror's spelling: modifiers Ctrl- Alt- Shift- Meta- and
// Mod- (⌘ on a Mac, Ctrl elsewhere), then the key as KeyboardEvent.key; a space separates the steps of
// a sequence ("Ctrl-x b"). Commands are registered by the page scripts in window.hyperCommands.
export default {
    bind: {
        "Mod-/": "nav.open",
        "Ctrl-j": "chat.nextUnread",
        "Ctrl-k": "chat.jumpBack",
        // ⌘J / ⌘K scroll the conversation on a Mac (Ctrl-J/K above are the chat jumps there too).
        "Meta-j": "chat.scrollDown",
        "Meta-k": "chat.scrollUp",
        "Mod-b": "dock.cycleMode",
        // Leaves the message box; bound inside text fields on purpose.
        "Escape": { command: "chat.blur", inInput: true },
        // The cheat sheet: "?" outside text fields (Shift is part of the symbol, so it is not written).
        "?": "keys.help",
    },
    // Keys of a scope work only while it is active (the page script says when: window.hyperKeyScopes.<name>)
    // and win over the global ones. Bare arrows, Enter and Escape in the menu are the box itself, not here.
    scopes: {
        help: {
            "Escape": "keys.helpClose",
            "?": "keys.helpClose",
        },
        menu: {
            "Mod-j": "menu.next",
            "Mod-k": "menu.prev",
            "Ctrl-j": "menu.next",
            "Ctrl-k": "menu.prev",
            // Touch typists: Ctrl-H / Ctrl-L as ← / → (⌘H would hide the window, ⌘L takes the address bar).
            "Ctrl-h": "menu.left",
            "Ctrl-l": "menu.right",
            "Mod-ArrowRight": "menu.nextWidget",
            "Mod-ArrowLeft": "menu.prevWidget",
            ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`Mod-${n}`, { command: "menu.tab", args: [n] }])),
        },
    },
};
