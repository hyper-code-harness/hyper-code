// UNIT test: keys/resolve.ts ↔ keys/$loader_keymap.ts — how $keymap_<name> files from several modules,
// the keymap a keymap extends and the personal keys.bindings setting become one table of bindings.
import { describe, expect, test } from "bun:test";
import loadKeymaps from "./$loader_keymap";
import resolve from "./resolve";

type Def = { extends?: string; bind?: Record<string, unknown>; scopes?: Record<string, Record<string, unknown>> };

function fixture(settings: Record<string, unknown> = {}) {
    const ctx: any = {
        state: {},
        fns: {
            procs: { log: { debug: () => {} } },
            settings: {
                get: async ({ key }: { key: string }) => {
                    const value = settings[key];
                    if (value instanceof Error) throw value;
                    return value;
                },
            },
        },
    };
    const load = (name: string, moduleDir: string, def: Def) =>
        loadKeymaps(ctx, null, { entries: [{ name, moduleDir, rel: `${moduleDir}/$keymap_${name}.ts`, mod: { default: def } }] });
    const run = (opts?: { keymap?: string }) => resolve(ctx, null, opts);
    const table = async (opts?: { keymap?: string }) =>
        Object.fromEntries((await run(opts)).bindings.map(b => [`${b.scope} ${b.keys}`, b.command]));
    return { ctx, load, run, table };
}

describe("keys.resolve", () => {
    test("the keys module comes first, other modules follow in name order", async () => {
        const f = fixture();
        await f.load("default", "dock", { bind: { "Mod-b": "dock.cycleMode" } });
        await f.load("default", "keys", { bind: { "Mod-/": "nav.open" }, scopes: { menu: { "Ctrl-j": "menu.next" } } });
        await f.load("default", "canvas", { bind: { "Mod-\\": "canvas.toggleChat" } });
        const result = await f.run();
        expect(result.keymap).toBe("default");
        expect(result.bindings.map(b => b.from)).toEqual([
            "keys/$keymap_default.ts", "keys/$keymap_default.ts", "canvas/$keymap_default.ts", "dock/$keymap_default.ts",
        ]);
        expect(await f.table()).toEqual({
            "global Mod-/": "nav.open",
            "menu Ctrl-j": "menu.next",
            "global Mod-\\": "canvas.toggleChat",
            "global Mod-b": "dock.cycleMode",
        });
    });

    test("a module taking a key another module bound in the same keymap is a conflict; the first stays", async () => {
        const f = fixture();
        await f.load("default", "keys", { bind: { "Mod-b": "dock.cycleMode" } });
        await f.load("default", "zz", { bind: { "Mod-b": "zz.steal", "Mod-y": "zz.own" } });
        const result = await f.run();
        expect(result.conflicts).toEqual([{ scope: "global", keys: "Mod-b", kept: "keys/$keymap_default.ts", dropped: "zz/$keymap_default.ts" }]);
        expect(await f.table()).toEqual({ "global Mod-b": "dock.cycleMode", "global Mod-y": "zz.own" });
    });

    test("the same key in different scopes is not a conflict", async () => {
        const f = fixture();
        await f.load("default", "keys", { bind: { "Ctrl-j": "chat.nextUnread" } });
        await f.load("default", "ui", { scopes: { menu: { "Ctrl-j": "menu.next" } } });
        const result = await f.run();
        expect(result.conflicts).toEqual([]);
        expect(await f.table()).toEqual({ "global Ctrl-j": "chat.nextUnread", "menu Ctrl-j": "menu.next" });
    });

    test("a keymap that extends another rebinds and unbinds its keys on purpose, without conflicts", async () => {
        const f = fixture();
        await f.load("default", "keys", { bind: { "Mod-/": "nav.open", "Mod-b": "dock.cycleMode", "Ctrl-k": "chat.jumpBack" } });
        await f.load("mine", "keys", { extends: "default", bind: { "Ctrl-k": "chat.scrollUp", "Mod-b": null, "Ctrl-x b": "nav.open" } });
        const result = await f.run({ keymap: "mine" });
        expect(result.keymap).toBe("mine");
        expect(result.conflicts).toEqual([]);
        expect(await f.table({ keymap: "mine" })).toEqual({
            "global Mod-/": "nav.open",
            "global Ctrl-k": "chat.scrollUp",
            "global Ctrl-x b": "nav.open",
        });
    });

    test("extends survives a cycle", async () => {
        const f = fixture();
        await f.load("a", "keys", { extends: "b", bind: { "Ctrl-1": "one" } });
        await f.load("b", "keys", { extends: "a", bind: { "Ctrl-2": "two" } });
        expect(await f.table({ keymap: "a" })).toEqual({ "global Ctrl-2": "two", "global Ctrl-1": "one" });
    });

    test("the keys.keymap setting picks the keymap; an unknown name or a failing setting falls back to default", async () => {
        const maps = async (f: ReturnType<typeof fixture>) => {
            await f.load("default", "keys", { bind: { "Mod-/": "nav.open" } });
            await f.load("other", "keys", { bind: { "Mod-o": "other.cmd" } });
        };
        const chosen = fixture({ keymap: "other" });
        await maps(chosen);
        expect((await chosen.run()).keymap).toBe("other");
        expect(await chosen.table()).toEqual({ "global Mod-o": "other.cmd" });

        for (const keymap of ["emacs", 42, new Error("settings down"), undefined]) {
            const f = fixture({ keymap });
            await maps(f);
            expect((await f.run()).keymap).toBe("default");
            expect(await f.table()).toEqual({ "global Mod-/": "nav.open" });
        }
    });

    test("personal bindings (keys.bindings) bind, unbind, reach named scopes and keep inInput and args", async () => {
        const f = fixture({
            bindings: {
                "Ctrl-x b": "nav.open",
                "Mod-b": null,
                "menu:Ctrl-n": "menu.next",
                "Ctrl-v": { command: "chat.scrollDown", inInput: false },
                "Ctrl-g": { command: "chat.blur", inInput: true },
                "Mod-1": { command: "menu.tab", args: [1] },
                "Ctrl-q": 7,
                "Ctrl-w": { inInput: true },
            },
        });
        await f.load("default", "keys", { bind: { "Mod-b": "dock.cycleMode", "Mod-/": "nav.open" }, scopes: { menu: { "Ctrl-j": "menu.next" } } });
        const { bindings, conflicts } = await f.run();
        expect(conflicts).toEqual([]);
        const by = Object.fromEntries(bindings.map(b => [`${b.scope} ${b.keys}`, b]));
        expect(Object.keys(by).sort()).toEqual([
            "global Ctrl-g", "global Ctrl-v", "global Ctrl-x b", "global Mod-/", "global Mod-1", "menu Ctrl-j", "menu Ctrl-n",
        ]);
        expect(by["global Ctrl-x b"]).toMatchObject({ command: "nav.open", from: "setting keys.bindings" });
        expect(by["global Ctrl-v"]).toMatchObject({ command: "chat.scrollDown", inInput: false });
        expect(by["global Ctrl-g"]).toMatchObject({ command: "chat.blur", inInput: true });
        expect(by["global Mod-1"]).toMatchObject({ command: "menu.tab", args: [1] });
        expect(by["global Mod-/"]!.inInput).toBeUndefined();
    });

    test("one spelling per chord: modifier order, aliases and letter case do not make a new key", async () => {
        const f = fixture({ bindings: { "Shift-Ctrl-X": "personal.x", "c-x B": "personal.seq", "cmd-alt-K": "personal.k" } });
        await f.load("default", "keys", { bind: { "Ctrl-Shift-x": "keys.x", "Ctrl-x b": "keys.seq", "Alt-Meta-k": "keys.k", "Escape": "keys.esc", "Mod--": "keys.minus" } });
        expect(await f.table()).toEqual({
            "global Ctrl-Shift-x": "personal.x",
            "global Ctrl-x b": "personal.seq",
            "global Alt-Meta-k": "personal.k",
            "global Escape": "keys.esc",
            "global Mod--": "keys.minus",
        });
    });

    test("no keymaps loaded: an empty default", async () => {
        const f = fixture({ bindings: { "Mod-/": "nav.open" } });
        const result = await f.run();
        expect(result.keymap).toBe("default");
        expect(result.bindings.map(b => b.keys)).toEqual(["Mod-/"]);
    });
});

describe("$keymap_ loader", () => {
    test("files of one keymap from several modules are kept per module; the project root is `app`", async () => {
        const f = fixture();
        await f.load("default", "keys", { bind: { "Mod-/": "nav.open" } });
        await f.load("default", "plugins/flow", { bind: { "Mod-f": "flow.open" } });
        await f.load("default", ".", { bind: { "Mod-p": "app.cmd" } });
        expect(Object.keys(f.ctx.state.keys.maps.default).sort()).toEqual(["app", "keys", "plugins.flow"]);
        expect(f.ctx.state.keys.maps.default.keys.scopes).toEqual({ global: { "Mod-/": "nav.open" } });
    });

    test("a module reloading its file replaces its own part only", async () => {
        const f = fixture();
        await f.load("default", "keys", { bind: { "Mod-/": "nav.open" } });
        await f.load("default", "dock", { bind: { "Mod-b": "dock.cycleMode" } });
        await f.load("default", "keys", { bind: { "Mod-k": "nav.open" } });
        expect(await f.table()).toEqual({ "global Mod-k": "nav.open", "global Mod-b": "dock.cycleMode" });
    });

    test("rejects files that cannot be a keymap, naming the file", async () => {
        const f = fixture();
        const bad: Array<[string, Def | any, RegExp]> = [
            ["Default", { bind: {} }, /keys\/\$keymap_Default\.ts: \$keymap_ name/],
            ["default", null, /must default-export/],
            ["default", { extends: "x" }, /must default-export/],
            ["default", { extends: 1, bind: {} }, /extends must be a keymap name/],
            ["default", { bind: {}, scopes: { "Menu Bar": {} } }, /scope "Menu Bar"/],
            ["default", { bind: { "Mod-b": 5 } }, /binding "Mod-b" \(global\)/],
            ["default", { scopes: { menu: { "Ctrl-j": { args: [1] } } } }, /binding "Ctrl-j" \(menu\)/],
            ["default", { bind: { "Mod-1": { command: "menu.tab", args: 1 } } }, /binding "Mod-1"/],
        ];
        for (const [name, def, error] of bad) {
            await expect(f.load(name, "keys", def)).rejects.toThrow(error);
        }
        expect(f.ctx.state.keys.maps).toEqual({});
    });

    test("accepts the binding forms resolve understands", async () => {
        const f = fixture();
        await f.load("default", "keys", { bind: {
            "Mod-/": "nav.open",
            "Mod-b": null,
            "Escape": { command: "chat.blur", inInput: true },
            "Mod-1": { command: "menu.tab", args: [1] },
        } });
        expect(Object.keys(f.ctx.state.keys.maps.default.keys.scopes.global)).toEqual(["Mod-/", "Mod-b", "Escape", "Mod-1"]);
    });
});
