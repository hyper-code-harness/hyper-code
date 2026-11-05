// UNIT test: keys/$script_keys.js — the browser key dispatcher, run against a minimal fake page
// (window / navigator / document) so its rules are checked without a browser: platform chords,
// text fields and inInput, sequences, scopes, `when`, Option symbols on a Mac, key labels.
import { describe, expect, test } from "bun:test";

const SOURCE = await Bun.file(new URL("./$script_keys.js", import.meta.url)).text();

type Binding = { keys: string; command: string; scope?: string; args?: unknown[]; inInput?: boolean };

function page(opts: { mac?: boolean; bindings: Binding[]; scopes?: Record<string, () => boolean> }) {
    const ran: Array<{ command: string; args: unknown[] }> = [];
    const window: any = {
        hyperKeymap: { keymap: "default", bindings: opts.bindings },
        hyperKeyScopes: { ...(opts.scopes ?? {}) },
        hyperCommands: {},
        addEventListener: () => {},
    };
    const navigator = { platform: opts.mac ? "MacIntel" : "Linux x86_64", userAgent: "" };
    const document = { querySelectorAll: () => [], addEventListener: () => {}, getElementById: () => null };
    new Function("window", "navigator", "document", SOURCE)(window, navigator, document);
    const command = (id: string, when?: () => boolean) => {
        window.hyperCommands[id] = { title: id, run: (_e: unknown, ...args: unknown[]) => ran.push({ command: id, args }), ...(when ? { when } : {}) };
    };
    const field = { tagName: "TEXTAREA" };
    const body = { tagName: "BODY" };
    // A keydown: "Ctrl-x" / "Meta-Shift-k" / "?" — modifiers then e.key; extra fields override.
    const key = (spec: string, extra: Record<string, unknown> = {}) => {
        const parts = spec.split(/-(?!$)/);
        const k = parts.pop()!;
        return window.hyperKeys.handle({
            key: k, code: "", target: body,
            ctrlKey: parts.includes("Ctrl"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift"), metaKey: parts.includes("Meta"),
            ...extra,
        }) as boolean;
    };
    return { window, ran, command, key, field };
}

describe("keys dispatcher", () => {
    test("Mod- is Ctrl off a Mac and Meta on a Mac", () => {
        const linux = page({ bindings: [{ keys: "Mod-b", command: "dock.cycleMode" }] });
        linux.command("dock.cycleMode");
        expect(linux.key("Meta-b")).toBe(false);
        expect(linux.key("Ctrl-b")).toBe(true);

        const mac = page({ mac: true, bindings: [{ keys: "Mod-b", command: "dock.cycleMode" }] });
        mac.command("dock.cycleMode");
        expect(mac.key("Ctrl-b")).toBe(false);
        expect(mac.key("Meta-b")).toBe(true);
        expect(linux.ran.length + mac.ran.length).toBe(2);
    });

    test("a key whose command is missing or not applicable is left to the browser", () => {
        const p = page({ bindings: [{ keys: "Mod-b", command: "dock.cycleMode" }, { keys: "Mod-/", command: "nav.open" }] });
        expect(p.key("Ctrl-b")).toBe(false);
        p.command("nav.open", () => false);
        expect(p.key("Ctrl-/")).toBe(false);
        expect(p.ran).toEqual([]);
    });

    test("keys already handled or still being composed are skipped", () => {
        const p = page({ bindings: [{ keys: "Mod-b", command: "x" }] });
        p.command("x");
        expect(p.key("Ctrl-b", { defaultPrevented: true })).toBe(false);
        expect(p.key("Ctrl-b", { isComposing: true })).toBe(false);
        expect(p.ran).toEqual([]);
    });

    test("in a text field: modified chords fire, bare keys do not, inInput overrides both ways", () => {
        const p = page({ bindings: [
            { keys: "?", command: "keys.help" },
            { keys: "Ctrl-j", command: "chat.nextUnread" },
            { keys: "Escape", command: "chat.blur", inInput: true },
            { keys: "Ctrl-v", command: "chat.scrollDown", inInput: false },
        ] });
        for (const id of ["chat.nextUnread", "chat.blur", "chat.scrollDown"]) p.command(id);
        const inField = { target: p.field };
        expect(p.key("?", inField)).toBe(false);
        expect(p.key("Ctrl-j", inField)).toBe(true);
        expect(p.key("Escape", inField)).toBe(true);
        expect(p.key("Ctrl-v", inField)).toBe(false);   // paste stays with the field
        expect(p.key("Ctrl-v")).toBe(true);             // outside it the binding works
        expect(p.ran.map(r => r.command)).toEqual(["chat.nextUnread", "chat.blur", "chat.scrollDown"]);
    });

    test("Shift belongs to a symbol but counts for letters and named keys", () => {
        const p = page({ bindings: [{ keys: "?", command: "keys.help" }, { keys: "Ctrl-Shift-k", command: "big.k" }, { keys: "Shift-Enter", command: "send" }] });
        for (const id of ["keys.help", "big.k", "send"]) p.command(id);
        expect(p.key("Shift-?")).toBe(true);
        expect(p.key("Ctrl-Shift-K")).toBe(true);
        expect(p.key("Ctrl-K")).toBe(false);
        expect(p.key("Shift-Enter")).toBe(true);
        expect(p.ran.map(r => r.command)).toEqual(["keys.help", "big.k", "send"]);
    });

    test("a sequence waits for its next step; Escape and Ctrl-g cancel it; an unknown step is swallowed", () => {
        const p = page({ bindings: [{ keys: "Ctrl-x b", command: "nav.open" }, { keys: "b", command: "bare.b" }] });
        p.command("nav.open");
        p.command("bare.b");
        expect(p.key("Ctrl-x")).toBe(true);
        expect(p.key("b")).toBe(true);
        expect(p.ran.map(r => r.command)).toEqual(["nav.open"]);

        for (const cancel of ["Escape", "Ctrl-g"]) {
            expect(p.key("Ctrl-x")).toBe(true);
            expect(p.key(cancel)).toBe(true);
            expect(p.key("b")).toBe(true);   // a fresh key now: the bare binding
        }
        expect(p.key("Ctrl-x")).toBe(true);
        expect(p.key("z")).toBe(true);       // unknown second step: taken, nothing runs
        expect(p.ran.map(r => r.command)).toEqual(["nav.open", "bare.b", "bare.b"]);
    });

    test("Escape and Ctrl-g cancel even where a sequence would continue with them", () => {
        const p = page({ bindings: [{ keys: "Ctrl-x Ctrl-g", command: "x.g" }, { keys: "Ctrl-x Escape", command: "x.esc" }] });
        p.command("x.g");
        p.command("x.esc");
        for (const cancel of ["Ctrl-g", "Escape"]) {
            expect(p.key("Ctrl-x")).toBe(true);
            expect(p.key(cancel)).toBe(true);
        }
        expect(p.ran).toEqual([]);
    });

    test("later steps of a modified sequence count as modified in a text field", () => {
        const p = page({ bindings: [{ keys: "Ctrl-x b", command: "nav.open" }, { keys: "g g", command: "top" }] });
        p.command("nav.open");
        p.command("top");
        const inField = { target: p.field };
        expect(p.key("Ctrl-x", inField)).toBe(true);
        expect(p.key("b", inField)).toBe(true);
        expect(p.key("g", inField)).toBe(false);   // a bare prefix is typing
        expect(p.ran.map(r => r.command)).toEqual(["nav.open"]);
    });

    test("a prefix is left to a text field when no sequence under it may finish there", () => {
        const p = page({ bindings: [
            { keys: "Ctrl-h b", command: "keys.help", inInput: false },
            { keys: "Ctrl-h ?", command: "keys.help", inInput: false },
        ] });
        p.command("keys.help");
        expect(p.key("Ctrl-h", { target: p.field })).toBe(false);   // delete-backward stays with the field
        expect(p.key("Ctrl-h")).toBe(true);
        expect(p.key("b")).toBe(true);
        expect(p.ran.map(r => r.command)).toEqual(["keys.help"]);
    });

    test("an active named scope wins over global; global keys still work under it", () => {
        let menuOpen = false;
        const p = page({
            scopes: { menu: () => menuOpen },
            bindings: [
                { keys: "Ctrl-j", command: "chat.nextUnread" },
                { keys: "Ctrl-j", command: "menu.next", scope: "menu" },
                { keys: "Mod-/", command: "nav.open" },
            ],
        });
        for (const id of ["chat.nextUnread", "menu.next", "nav.open"]) p.command(id);
        expect(p.key("Ctrl-j")).toBe(true);
        menuOpen = true;
        expect(p.key("Ctrl-j")).toBe(true);
        expect(p.key("Ctrl-/")).toBe(true);
        expect(p.ran.map(r => r.command)).toEqual(["chat.nextUnread", "menu.next", "nav.open"]);
    });

    test("a scope whose test throws counts as inactive", () => {
        const p = page({
            scopes: { menu: () => { throw new Error("gone"); } },
            bindings: [{ keys: "Ctrl-j", command: "global.j" }, { keys: "Ctrl-j", command: "menu.next", scope: "menu" }],
        });
        p.command("global.j");
        p.command("menu.next");
        expect(p.key("Ctrl-j")).toBe(true);
        expect(p.ran.map(r => r.command)).toEqual(["global.j"]);
    });

    test("binding args reach the command", () => {
        const p = page({ bindings: [{ keys: "Mod-3", command: "menu.tab", args: [3] }] });
        p.command("menu.tab");
        expect(p.key("Ctrl-3")).toBe(true);
        expect(p.ran).toEqual([{ command: "menu.tab", args: [3] }]);
    });

    test("a command that throws still takes the key", () => {
        const p = page({ bindings: [{ keys: "Mod-b", command: "boom" }] });
        p.window.hyperCommands.boom = { run: () => { throw new Error("boom"); } };
        const error = console.error;
        console.error = () => {};
        try { expect(p.key("Ctrl-b")).toBe(true); } finally { console.error = error; }
    });

    test("Alt chords: the Option symbol on a Mac names the letter, then the physical key", () => {
        const p = page({ mac: true, bindings: [{ keys: "Alt-x", command: "nav.open" }, { keys: "Alt-v", command: "chat.scrollUp" }] });
        p.command("nav.open");
        p.command("chat.scrollUp");
        expect(p.key("Alt-≈", { code: "KeyB" })).toBe(true);    // ⌥x types ≈ whatever the physical key
        expect(p.key("Alt-Dead", { code: "KeyV" })).toBe(true); // a dead key falls back to e.code
        expect(p.key("Alt-x", { code: "KeyQ" })).toBe(true);    // a plain letter in e.key is used as it is
        expect(p.ran.map(r => r.command)).toEqual(["nav.open", "chat.scrollUp", "nav.open"]);
    });

    test("labels: Mac symbols, Ctrl+ elsewhere, sequences keep their steps", () => {
        const bindings = [{ keys: "Mod-b", command: "dock.cycleMode" }, { keys: "Ctrl-x b", command: "nav.open" }, { keys: "Mod-/", command: "nav.open" }];
        const mac = page({ mac: true, bindings });
        const linux = page({ bindings });
        expect(mac.window.hyperKeys.label("dock.cycleMode")).toBe("⌘B");
        expect(linux.window.hyperKeys.label("dock.cycleMode")).toBe("Ctrl+B");
        expect(linux.window.hyperKeys.label("nav.open")).toBe("Ctrl+X B, Ctrl+/");
        expect(mac.window.hyperKeys.label("nav.open", "menu")).toBe("");
    });

    test("loads once per page", () => {
        const p = page({ bindings: [] });
        const first = p.window.hyperKeys;
        new Function("window", "navigator", "document", SOURCE)(p.window, {}, {});
        expect(p.window.hyperKeys).toBe(first);
    });
});
