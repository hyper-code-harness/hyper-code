// Autotext lab: CodeMirror 6 editor with inline ghost-text suggestions.
// Bundled on request by the script loader, so @codemirror/* imports resolve from node_modules.
// Safe to re-run after htmx swaps (guarded by a data attribute on the host).
import { EditorView, Decoration, WidgetType, keymap, placeholder, drawSelection } from "@codemirror/view";
import { EditorState, StateField, StateEffect, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

const DEBOUNCE_MS = 3000;

// Keep the model's spaces verbatim: a fabricated space breaks completions mid-word.
// Only strip a repeated *whole phrase* at a word boundary, not a coincidental 3-letter overlap.
export function trimRepeatedPrefix(before, suggestion) {
    if (!before || !suggestion) return suggestion;
    const lead = /^\s*/.exec(suggestion)?.[0] ?? "";
    const source = before.trimEnd();
    for (let n = Math.min(source.length, suggestion.length - lead.length, 300); n >= 4; n--) {
        const start = source.length - n;
        if (start > 0 && /[\p{L}\p{N}]/u.test(source[start - 1])) continue;
        if (/[\p{L}\p{N}]/u.test(suggestion[lead.length + n] ?? "") && /[\p{L}\p{N}]/u.test(suggestion[lead.length + n - 1] ?? "")) continue;
        if (source.slice(start) === suggestion.slice(lead.length, lead.length + n)) return suggestion.slice(lead.length + n);
    }
    return suggestion;
}

// If the model also wrote the existing text after the cursor, insert only the new part.
export function trimRepeatedSuffix(suggestion, after) {
    if (!after || !suggestion) return suggestion;
    for (let n = Math.min(suggestion.length, after.length, 300); n >= 4; n--) {
        const start = suggestion.length - n;
        if (start > 0 && /[\p{L}\p{N}]/u.test(suggestion[start - 1])) continue;
        if (/[\p{L}\p{N}]/u.test(after[n] ?? "") && /[\p{L}\p{N}]/u.test(after[n - 1] ?? "")) continue;
        if (suggestion.slice(start) === after.slice(0, n)) return suggestion.slice(0, start);
    }
    return suggestion;
}

// Replace at most the current sentence fragment, never previous sentences or paragraphs.
export function sentenceTail(before) {
    const start = Math.max(0, before.length - 300);
    const chunk = before.slice(start);
    const match = /(?:[.!?…]["'»)]*\s+|\n)/gu;
    let boundary = 0;
    for (const found of chunk.matchAll(match)) boundary = found.index + found[0].length;
    const raw = chunk.slice(boundary);
    const lead = /^\s*/u.exec(raw)?.[0].length ?? 0;
    return { from: start + boundary + lead, text: raw.slice(lead) };
}

export function rewritePreview(before, after, tail, answer) {
    if (!answer || !answer.trim() || answer.length > 600 || !tail.text || !before.endsWith(tail.text)) return null;
    const cleaned = trimRepeatedSuffix(answer, after);
    if (!cleaned.trim()) return null;
    return { from: tail.from, to: before.length, original: tail.text, text: cleaned };
}

class GhostWidget extends WidgetType {
    constructor(text, original = "") { super(); this.text = text; this.original = original; }
    eq(other) { return other.text === this.text && other.original === this.original; }
    toDOM() {
        const span = document.createElement("span");
        span.className = "cm-autotext-ghost";
        span.setAttribute("aria-hidden", "true");
        if (this.original) {
            const label = document.createElement("span");
            label.className = "cm-autotext-replace-label";
            label.textContent = " ↳ replace: " + this.text;
            span.append(label);
        } else span.textContent = this.text;
        return span;
    }
    ignoreEvent() { return true; }
}

const setGhost = StateEffect.define();
// Ghost = { pos, text, from?, original? } | null. Any edit or cursor move drops it, so a late answer never lands in the wrong place.
const ghostField = StateField.define({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setGhost)) return e.value;
        if (!value) return null;
        if (tr.docChanged) return null;
        if (tr.selection && tr.state.selection.main.head !== value.pos) return null;
        return value;
    },
    provide: field => EditorView.decorations.from(field, g => g
        ? Decoration.set([
            ...(g.original ? [Decoration.mark({ class: "cm-autotext-replaced" }).range(g.from, g.pos)] : []),
            Decoration.widget({ widget: new GhostWidget(g.text, g.original), side: 1 }).range(g.pos),
        ])
        : Decoration.none),
});

(() => {
    if (typeof document === "undefined") return;
    const host = document.getElementById("autotext-editor");
    if (!host || host.dataset.autotextReady) return;
    host.dataset.autotextReady = "1";
    const model = document.getElementById("autotext-model");
    const auto = document.getElementById("autotext-auto");
    const rewrite = document.getElementById("autotext-rewrite");
    const request = document.getElementById("autotext-request");
    const status = document.getElementById("autotext-status");
    let pending = null, timer = null, serial = 0;

    function cancel() {
        ++serial;
        if (timer) { clearTimeout(timer); timer = null; }
        if (pending) { pending.abort(); pending = null; }
    }
    function dismiss(view) {
        cancel();
        if (view.state.field(ghostField)) view.dispatch({ effects: setGhost.of(null) });
    }
    function accept(view) {
        const g = view.state.field(ghostField);
        if (!g || (g.original && view.state.doc.sliceString(g.from, g.pos) !== g.original)) return false;
        cancel();
        view.dispatch({
            changes: { from: g.original ? g.from : g.pos, to: g.pos, insert: g.text },
            selection: { anchor: (g.original ? g.from : g.pos) + g.text.length },
            effects: setGhost.of(null),
            userEvent: "input.complete",
        });
        status.textContent = "Inserted.";
        return true;
    }

    async function suggest(view) {
        cancel();
        const state = view.state;
        const sel = state.selection.main;
        if (!sel.empty) { status.textContent = "Collapse the selection to get a suggestion."; return; }
        const doc = state.doc.toString();
        const before = doc.slice(0, sel.head), after = doc.slice(sel.head);
        if (!before.trim()) { status.textContent = ""; return; }
        const current = serial, selectedModel = model.value, docAtRequest = state.doc;
        const tail = rewrite.checked ? sentenceTail(before) : null;
        const rewriteRequest = !!tail && tail.text.trim().length >= 4;
        const rewriteEnabled = rewrite.checked;
        const ctrl = new AbortController();
        pending = ctrl;
        status.textContent = "Thinking…";
        const started = performance.now();
        try {
            const res = await fetch("/autotext/suggest", {
                method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
                body: JSON.stringify({ model: selectedModel, before, after, ...(rewriteRequest ? { rewrite: true, tail: tail.text } : {}) }),
            });
            const body = await res.json().catch(() => ({}));
            if (current !== serial) return;
            pending = null;
            if (!res.ok) { status.textContent = body.error || `Error ${res.status}`; return; }
            // Stale guard: text, cursor and model must be exactly as when we asked.
            const now = view.state;
            if (now.doc !== docAtRequest || now.selection.main.head !== sel.head || !now.selection.main.empty || model.value !== selectedModel || rewrite.checked !== rewriteEnabled) return;
            const total = Math.round(performance.now() - started);
            if (rewriteRequest) {
                if (body.replaceChars !== tail.text.length) { status.textContent = "Unsafe replacement ignored."; return; }
                const preview = rewritePreview(before, after, tail, String(body.text || ""));
                if (!preview) { status.textContent = `No suggestion · ${total} ms`; return; }
                view.dispatch({ effects: setGhost.of({ pos: sel.head, ...preview }) });
                status.textContent = `${body.model || selectedModel} · ${total} ms — highlighted text will be replaced on Tab; Esc dismisses`;
                return;
            }
            let text = trimRepeatedSuffix(trimRepeatedPrefix(before, String(body.text || "")), after);
            if (!text.trim()) { status.textContent = `No suggestion · ${total} ms`; return; }
            view.dispatch({ effects: setGhost.of({ pos: sel.head, text }) });
            status.textContent = `${body.model || selectedModel} · model ${body.ms ?? "?"} ms · total ${total} ms — Tab accepts, Esc dismisses`;
        } catch (error) {
            if (current !== serial || error?.name === "AbortError") return;
            pending = null;
            status.textContent = "Request failed.";
        }
    }

    function schedule(view) {
        cancel();
        if (!auto.checked) return;
        timer = setTimeout(() => { timer = null; suggest(view); }, DEBOUNCE_MS);
    }

    const ghostKeys = Prec.highest(keymap.of([
        { key: "Tab", run: accept },
        { key: "Escape", run: view => { const had = !!view.state.field(ghostField) || !!pending; dismiss(view); if (had) status.textContent = ""; return had; } },
        { key: "Mod-Space", run: view => { suggest(view); return true; } },
    ]));

    const view = new EditorView({
        parent: host,
        state: EditorState.create({
            doc: "",
            extensions: [
                ghostKeys, ghostField, history(), drawSelection(),
                keymap.of([...defaultKeymap, ...historyKeymap]),
                EditorView.lineWrapping,
                placeholder("Start writing an article here…"),
                EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Article draft" }),
                EditorView.updateListener.of(update => {
                    if (update.docChanged && update.transactions.some(t => t.isUserEvent("input") || t.isUserEvent("delete")) && !update.transactions.some(t => t.isUserEvent("input.complete"))) schedule(update.view);
                    else if (update.docChanged || (update.selectionSet && !update.state.field(ghostField))) cancel();
                }),
                EditorView.theme({
                    "&": { minHeight: "20rem", fontSize: "1rem" },
                    "&.cm-focused": { outline: "none" },
                    ".cm-content": { padding: "1rem", lineHeight: "1.65", fontFamily: "inherit", caretColor: "currentColor" },
                    ".cm-scroller": { fontFamily: "inherit" },
                    ".cm-autotext-ghost": { opacity: "0.45", fontStyle: "italic", pointerEvents: "none" },
                    ".cm-autotext-replaced": { backgroundColor: "#fef08a80", textDecoration: "underline wavy #ca8a04" },
                    ".cm-autotext-replace-label": { backgroundColor: "#fef9c3", color: "#713f12", opacity: "1", fontStyle: "normal", borderRadius: "3px", padding: "1px 3px" },
                }),
            ],
        }),
    });

    model.addEventListener("change", () => { dismiss(view); status.textContent = ""; view.focus(); });
    rewrite.addEventListener("change", () => { dismiss(view); status.textContent = ""; view.focus(); });
    auto.addEventListener("change", () => { dismiss(view); if (auto.checked) schedule(view); view.focus(); });
    request.addEventListener("click", () => { suggest(view); view.focus(); });
    view.focus();
})();
