import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const script = readFileSync(new URL("./$script_hotkeys.js", import.meta.url), "utf8");
const contextMenu = script.slice(script.indexOf("// Right-click menus"), script.indexOf("// The folded chat strip"));

function setup() {
    const window = new Window({ url: "http://localhost/agent/test" });
    const { document } = window;
    // happy-dom does not implement the native popover top layer. Model its observable state.
    const menu = document.createElement("div");
    menu.className = "w-menu";
    menu.dataset.contextOf = ".tab";
    menu.id = "tab-menu";
    const host = document.createElement("div");
    host.className = "tab";
    const outside = document.createElement("button");
    document.body.append(host, menu, outside);
    let open = false;
    menu.showPopover = () => { open = true; menu.setAttribute("data-open", ""); };
    menu.hidePopover = () => { open = false; menu.removeAttribute("data-open"); };
    const nativeMatches = menu.matches.bind(menu);
    menu.matches = selector => selector === ":popover-open" ? open : nativeMatches(selector.replace(":popover-open", "[data-open]"));
    const nativeQuery = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => nativeQuery(selector.replace(":popover-open", "[data-open]"));
    window.eval(contextMenu);
    return { window, document, menu, host, outside, isOpen: () => open };
}

test("context menu closes on outside click and stays open on inside click", () => {
    const { window, menu, host, outside, isOpen } = setup();
    host.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(isOpen()).toBe(true);
    menu.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(isOpen()).toBe(true);
    outside.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(isOpen()).toBe(false);
});

test("outside click also closes an ordinary open w.menu", () => {
    const { window, document, menu, outside } = setup();
    menu.removeAttribute("data-context-of");
    menu.showPopover();
    expect(menu.matches(":popover-open")).toBe(true);
    outside.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(menu.matches(":popover-open")).toBe(false);
});


test("context menu Reload tab selects its owning tab then reloads", async () => {
    const { window, document, menu, host, isOpen } = setup();
    const panel = document.createElement("section");
    panel.dataset.canvasPanel = "";
    host.replaceWith(panel);
    panel.append(host);
    const tab = document.createElement("button");
    tab.dataset.canvasTab = "7";
    host.append(tab);
    const body = document.createElement("div");
    body.dataset.canvasBody = "";
    body.dataset.canvasItem = "5";
    panel.append(body);
    const reload = document.createElement("button");
    reload.dataset.canvasReload = "";
    panel.append(reload);
    const item = document.createElement("button");
    item.className = "w-menu-item";
    item.dataset.action = "reload-canvas-tab";
    menu.append(item);
    let clicks = 0;
    reload.addEventListener("click", () => { clicks++; });
    tab.addEventListener("click", () => { body.dataset.canvasItem = "7"; });
    host.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(isOpen()).toBe(true);
    item.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(body.dataset.canvasItem).toBe("7");
    expect(clicks).toBe(1);
});
