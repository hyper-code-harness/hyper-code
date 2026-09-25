// CodeMirror 6 editor with autosave + optional vim mode.
// Uses the prebuilt bundle exposed on window.__cm (see src/ui/bundle.entry.ts).
// Config comes from window.__editor = { saveUrl, content, lang }.
(async function () {
    const cfg = window.__editor;
    if (!cfg) return;

    // Wait for bundle.js to populate window.__cm (defer means it runs before
    // other defer scripts in source order, but bundle is listed earlier).
    let cm = window.__cm;
    let waited = 0;
    while (!cm && waited < 5000) {
        await new Promise(r => setTimeout(r, 50));
        cm = window.__cm;
        waited += 50;
    }
    if (!cm) { console.error("[editor] bundle not loaded (run: bun script/build-bundle.ts)"); return; }

    const { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
        drawSelection, dropCursor, rectangularSelection, highlightSpecialChars } = cm.view;
    const { EditorState, StateEffect } = cm.state;
    const { defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap } = cm.language;
    const { defaultKeymap, history, historyKeymap, indentWithTab } = cm.commands;
    const { searchKeymap, highlightSelectionMatches } = cm.search;
    const { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } = cm.autocomplete;
    const { lintKeymap } = cm.lint;

    const langExt = [];
    if (cfg.lang) {
        const mod = cm.langs[cfg.lang];
        try {
            if (cfg.lang === "json") langExt.push(mod.javascript({ jsx: false }));
            else if (cfg.lang === "javascript") langExt.push(mod.javascript({ jsx: true, typescript: true }));
            else if (mod && typeof mod[cfg.lang] === "function") langExt.push(mod[cfg.lang]());
        } catch (e) { console.warn("[editor] lang", cfg.lang, e); }
    }

    const theme = EditorView.theme({
        "&": { height: "100%", fontSize: "12.5px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
        ".cm-gutters": { background: "#f9fafb", borderRight: "1px solid #e5e7eb" },
        ".cm-activeLineGutter": { background: "#eef2ff" },
        ".cm-activeLine": { background: "#f5f3ff40" },
        ".cm-cursor": { borderLeftColor: "#111827" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { background: "#c7d2fe80" },
    });

    const statusEl = document.getElementById("save-status");
    let timer = null;
    function status(text, cls) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = "text-xs " + cls;
        statusEl.classList.remove("hidden");
    }

    const saveExt = EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        if (timer) clearTimeout(timer);
        status("modified", "text-warning");
        timer = setTimeout(() => {
            const body = u.state.doc.toString();
            fetch(cfg.saveUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body })
                .then(r => status(r.ok ? "saved" : "save failed", r.ok ? "text-success" : "text-error"))
                .catch(() => status("save failed", "text-error"));
        }, 800);
    });

    const extensions = [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(),
        foldGutter(), drawSelection(), dropCursor(),
        EditorState.allowMultipleSelections.of(true), indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(), closeBrackets(), autocompletion(), rectangularSelection(),
        highlightActiveLine(), highlightSelectionMatches(),
        keymap.of([
            ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap,
            ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab,
        ]),
        theme, saveExt, ...langExt,
    ];

    const host = document.getElementById("cm-editor");
    // On an htmx swap the script re-runs while a previous editor may still be
    // mounted in a host that has just been replaced. Mounting a second view
    // into the same node stacks two editors, and the old one keeps its autosave
    // timer pointed at the PREVIOUS file. Bail if the host is gone, clear it if
    // it is not.
    if (!host) return;
    if (window.__cmView) {
        try { window.__cmView.destroy(); } catch { /* already gone with its node */ }
        window.__cmView = null;
    }
    host.replaceChildren();
    let editor = new EditorView({
        state: EditorState.create({ doc: cfg.content, extensions }),
        parent: host,
    });
    window.__cmView = editor;

    const vimToggle = document.getElementById("vim-toggle");
    const vimStatus = document.getElementById("vim-status");
    let vimExt = null;

    function enableVim() {
        if (!vimExt) vimExt = cm.vim.vim();
        editor.dispatch({ effects: StateEffect.appendConfig.of(vimExt) });
        if (vimStatus) { vimStatus.classList.remove("hidden"); vimStatus.textContent = "-- NORMAL --"; }
    }
    function disableVim() {
        const doc = editor.state.doc.toString();
        editor.destroy();
        editor = new EditorView({ state: EditorState.create({ doc, extensions }), parent: host });
        window.__cmView = editor;
        if (vimStatus) vimStatus.classList.add("hidden");
    }

    if (vimToggle) {
        if (localStorage.getItem("cm-vim") === "1") { vimToggle.checked = true; enableVim(); }
        vimToggle.addEventListener("change", () => {
            localStorage.setItem("cm-vim", vimToggle.checked ? "1" : "0");
            vimToggle.checked ? enableVim() : disableVim();
        });
    }

    editor.focus();
})();
