// Real Chrome, a throwaway HTTP origin, and rendered Dock markup. No connection to the
// person's browser: testChrome is the suite's isolated headless browser/profile.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
let server: ReturnType<typeof Bun.serve>;
let origin: string;
let dock: string;

beforeAll(async () => {
    const ctx = await mkTestCtx();
    const shell = await ctx.fns.ui.layout({ main: "" });
    const tag = '<script src="/ui/theme.js"></script>';
    expect(shell).toContain(tag);
    expect(shell.indexOf(tag)).toBeLessThan(shell.indexOf('<link rel="stylesheet"'));
    dock = await ctx.fns.dock.render({});
    const page = `<!doctype html><html><head>${tag}
        <script>window.beforeCSS = { theme: document.documentElement.dataset.theme, scheme: document.documentElement.style.colorScheme };</script>
        <style>html[data-theme="light"] { background: rgb(255,255,255); } html[data-theme="dark"] { background: rgb(16,16,16); }</style>
        <script>window.hyperLive = {subscribe() {}};</script>
        </head><body>${dock}</body></html>`;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async request => {
        const path = new URL(request.url).pathname;
        if (path === "/ui/theme.js" || path === "/dock/dock.js") {
            const route = ctx.state.procs.http.routes[path]?.GET;
            if (!route) throw new Error(`Missing browser asset route: ${path}`);
            return route(ctx, null, { req: request });
        }
        if (path === "/") return new Response(page, { headers: { "content-type": "text/html" } });
        if (path === "/dock") return new Response(dock, { headers: { "content-type": "text/html" } });
        return new Response("Not found", { status: 404 });
    } });
    origin = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server?.stop(true));

async function openTab(opts: { system?: "dark" | "light"; stored?: string | null; setup?: string } = {}) {
    const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    ws.onmessage = event => {
        const message = JSON.parse(String(event.data));
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
    };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
        pending.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async (expression: string) => {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result?.value;
    };
    const media = (value: "dark" | "light") => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
    const close = async () => {
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Tab closed")); }
        pending.clear();
        ws.close();
        await fetch(`${CDP}/json/close/${target.id}`);
    };
    try {
        await send("Page.enable");
        await media(opts.system ?? "light");
        let seed = "";
        if (opts.stored !== undefined) seed = opts.stored === null ? "localStorage.removeItem('hyper-theme');" : `localStorage.setItem('hyper-theme', ${JSON.stringify(opts.stored)});`;
        await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.themeErrors=[]; addEventListener('error', e => themeErrors.push(e.message)); ${seed} ${opts.setup ?? ""}` });
        await send("Page.navigate", { url: origin });
        await waitFor(() => evaluate("document.readyState === 'complete' && !!window.hyperTheme && !!window.hyperDock"));
        return { evaluate, media, send, close };
    } catch (error) { await close(); throw error; }
}

async function waitFor(check: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await check()) return;
        await Bun.sleep(25);
    }
    throw new Error("Theme condition did not settle");
}

const state = `(() => ({theme: document.documentElement.dataset.theme, preference: document.documentElement.dataset.themePreference, scheme: document.documentElement.style.colorScheme, label: document.querySelector('#theme-toggle .w-row-hint')?.textContent, pressed: document.getElementById('theme-toggle')?.getAttribute('aria-pressed')}))()`;

test.skipIf(!CDP)("saved light/dark win over the OS before CSS, invalid storage follows the OS", async () => {
    for (const [stored, system, expected] of [["light", "dark", "light"], ["dark", "light", "dark"], ["invalid", "dark", "dark"], [null, "light", "light"]] as const) {
        const tab = await openTab({ stored, system });
        try {
            expect(await tab.evaluate("window.beforeCSS")).toEqual({ theme: expected, scheme: expected });
            expect((await tab.evaluate(state)).theme).toBe(expected);
            expect(await tab.evaluate("getComputedStyle(document.documentElement).backgroundColor")).toBe(expected === "dark" ? "rgb(16, 16, 16)" : "rgb(255, 255, 255)");
            expect(await tab.evaluate("themeErrors")).toEqual([]);
        } finally { await tab.close(); }
    }
}, 20_000);

test.skipIf(!CDP)("system changes apply only in System mode; both explicit themes remain reachable", async () => {
    const tab = await openTab({ stored: null, system: "light" });
    try {
        expect(await tab.evaluate(state)).toMatchObject({ theme: "light", preference: "system", label: "System · Light" });
        await tab.media("dark");
        await waitFor(() => tab.evaluate("document.documentElement.dataset.theme === 'dark'"));
        await tab.evaluate("document.querySelector('#theme-toggle').click()");
        expect(await tab.evaluate(state)).toMatchObject({ theme: "light", preference: "light" });
        expect(await tab.evaluate("localStorage.getItem('hyper-theme')")).toBe("light");
        await tab.media("light");
        await tab.media("dark");
        await Bun.sleep(75);
        expect((await tab.evaluate(state)).theme).toBe("light");
        await tab.evaluate("document.querySelector('#theme-toggle').click()");
        expect(await tab.evaluate("localStorage.getItem('hyper-theme')")).toBe("dark");
        await tab.evaluate("document.querySelector('#theme-system').click()");
        expect(await tab.evaluate("document.querySelector('#theme-system').getAttribute('aria-pressed')")).toBe('true');
        expect(await tab.evaluate("localStorage.getItem('hyper-theme')")).toBeNull();
        expect(await tab.evaluate(state)).toMatchObject({ theme: "dark", preference: "system" });
        await tab.media("light");
        await waitFor(() => tab.evaluate("document.documentElement.dataset.theme === 'light'"));
    } finally { await tab.close(); }
}, 15_000);

test.skipIf(!CDP)("real storage events sync tabs, including remove, clear, and invalid values", async () => {
    const first = await openTab({ stored: "light", system: "light" });
    const second = await openTab({ system: "dark" });
    try {
        await first.evaluate("document.querySelector('#theme-toggle').click()");
        await waitFor(() => second.evaluate("document.documentElement.dataset.themePreference === 'dark'"));
        await first.evaluate("hyperTheme.set('system')");
        await waitFor(() => second.evaluate("document.documentElement.dataset.themePreference === 'system'"));
        expect((await first.evaluate(state)).theme).toBe("light");
        expect((await second.evaluate(state)).theme).toBe("dark");
        await first.evaluate("localStorage.setItem('hyper-theme','light')");
        await waitFor(() => second.evaluate("document.documentElement.dataset.theme === 'light'"));
        await first.evaluate("localStorage.clear()");
        await waitFor(() => second.evaluate("document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.themePreference === 'system'"));
        await first.evaluate("localStorage.setItem('hyper-theme','light')");
        await waitFor(() => second.evaluate("document.documentElement.dataset.theme === 'light'"));
        await first.evaluate("localStorage.setItem('hyper-theme','invalid')");
        await waitFor(() => second.evaluate("document.documentElement.dataset.themePreference === 'system'"));
        await second.evaluate("dispatchEvent(new StorageEvent('storage', {key:'hyper-theme', newValue:'light', storageArea:sessionStorage}))");
        expect((await second.evaluate(state)).theme).toBe("dark");
    } finally { await first.close(); await second.close(); }
}, 15_000);

test.skipIf(!CDP)("Dock refresh repaints controls; duplicate loading does not double-toggle; keyboard works", async () => {
    const tab = await openTab({ stored: "dark", system: "light" });
    try {
        await tab.evaluate("window.oldDock = document.getElementById('dock'); hyperDock.refresh()");
        expect(await tab.evaluate("oldDock !== document.getElementById('dock')")).toBe(true);
        expect(await tab.evaluate(state)).toMatchObject({ theme: "dark", label: "Dark", pressed: "true" });
        expect(await tab.evaluate("document.getElementById('theme-toggle').getAttribute('aria-label')")).toContain("Use light theme");
        await tab.evaluate("new Promise((resolve,reject) => { const s=document.createElement('script'); s.src='/ui/theme.js'; s.onload=resolve; s.onerror=reject; document.head.append(s); })");
        await tab.send("Page.bringToFront");
        await tab.evaluate("document.querySelector('#dock-settings-popup').showPopover(); document.querySelector('#theme-toggle').focus()");
        expect(await tab.evaluate("document.activeElement?.id")).toBe("theme-toggle");
        await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
        await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        expect(await tab.evaluate(state)).toMatchObject({ theme: "light", label: "Light", pressed: "false" });
    } finally { await tab.close(); }
}, 15_000);

test.skipIf(!CDP)("denied localStorage still follows the OS and accepts in-tab choices", async () => {
    const tab = await openTab({ system: "dark", setup: "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError')}});" });
    try {
        expect(await tab.evaluate("window.beforeCSS")).toEqual({ theme: "dark", scheme: "dark" });
        await tab.media("light");
        await waitFor(() => tab.evaluate("document.documentElement.dataset.theme === 'light'"));
        await tab.evaluate("document.querySelector('#theme-toggle').click()");
        expect(await tab.evaluate(state)).toMatchObject({ theme: "dark", preference: "dark" });
        await tab.evaluate("hyperTheme.set('system')");
        expect(await tab.evaluate(state)).toMatchObject({ theme: "light", preference: "system" });
        expect(await tab.evaluate("themeErrors")).toEqual([]);
    } finally { await tab.close(); }
}, 15_000);

test.skipIf(!CDP)("blocked writes do not undo in-tab choices or break System mode", async () => {
    const tab = await openTab({ stored: "dark", system: "dark", setup: "Storage.prototype.setItem = Storage.prototype.removeItem = function(){throw new DOMException('Full','QuotaExceededError')};" });
    try {
        await tab.evaluate("document.querySelector('#theme-toggle').click()");
        expect(await tab.evaluate(state)).toMatchObject({ theme: "light", preference: "light" });
        await tab.evaluate("hyperTheme.set('system')");
        expect(await tab.evaluate(state)).toMatchObject({ theme: "dark", preference: "system" });
        expect(await tab.evaluate("themeErrors")).toEqual([]);
    } finally { await tab.close(); }
}, 15_000);
