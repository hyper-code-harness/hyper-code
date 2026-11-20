// Canvas shortcuts, added to the default keymap (see src/keys/$keymap_default.ts for the key spelling).
export default {
    bind: {
        "Mod-\\": "canvas.toggleChat",
    },
    // In the folded chat's message box (window.hyperKeyScopes.foldedChat, canvas.js) the key that came here
    // (Mod-i, chat.focus) goes back: the bubbles close and the field folds into the circle.
    scopes: {
        foldedChat: {
            "Mod-i": "canvas.hideChat",
        },
    },
};
