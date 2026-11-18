// Real computed-style regression tests: compiled production CSS, no browser.* calls and no live profile.
// Keep fixture-only rules structural; copying a palette into fixture CSS would hide mixed-theme bugs.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

type Theme = "light" | "dark" | "contrast";
type RGB = [number, number, number, number];
type Sample = { color: RGB; background: RGB; effectiveBackground: RGB; border: RGB; contrast: number; scheme: string; width: number };
type Scope = { id: string; theme: Theme; tokens: Record<string, RGB>; samples: Record<string, Sample> };
type Snapshot = { width: number; scrollWidth: number; cssCount: number; body: Sample; scopes: Scope[] };

const CDP = (await testChrome()) ?? "";
let server: ReturnType<typeof Bun.serve>;
let origin: string;
let fixture = "";
const scopeThemes: Record<string, Theme | "root"> = {
    root: "root", dark: "dark", "dark-light": "light", "dark-contrast": "contrast",
    light: "light", "light-dark": "dark", contrast: "contrast", "contrast-dark": "dark", "contrast-light": "light",
};

beforeAll(async () => {
    if (!CDP) return;
    const ctx = await mkTestCtx();
    // Independent keys prevent the server/test workers from overwriting each other's cached sheets.
    // Unique keys also prevent styles.build's last-good fallback masking a failed compilation.
    const key = `w-theme-browser-${process.pid}-${Date.now()}`;
    const paths = new Map<string, string>();
    for (const [name, source] of [["app", "../procs/styles/$style_app.css"], ["w", "./$style_w.css"]]) {
        paths.set(`/css/${name}.css`, await ctx.fns.procs.styles.build({ abs: join(import.meta.dir, source!), key: `${key}-${name}`, force: true }));
    }
    // mkTestCtx intentionally stubs markdown.highlight. Use Shiki's local bundled grammar/themes,
    // exactly as markdown.highlight does, rather than that stub or a remote asset.
    const { codeToHtml } = await import("shiki");
    const code = await codeToHtml("const answer = 42;", {
        lang: "typescript", themes: { light: "github-light", dark: "github-dark", contrast: "github-light-high-contrast" }, defaultColor: false,
    });
    const sample = () => `
        <section class="w-pane" data-probe="pane"><header class="w-pane-header" data-probe="header"><span class="w-pane-title">Conversation</span></header>
        <div class="w-pane-body">
            <div class="w-pane" data-surface="chat" data-probe="chat">Conversation surface</div>
            <div class="w-msg" data-role="user"><div class="w-msg-body" data-probe="user"><div class="w-msg-text">A message from me</div></div></div>
            <div class="w-markdown" data-probe="markdown"><h2 data-probe="markdown-heading">Readable heading</h2><p data-probe="markdown-text">Readable assistant text and <a href="#" data-probe="markdown-link">a link</a>.</p>
                <p><code data-probe="markdown-inline">answer</code></p><div data-probe="markdown-shiki">${code}</div>
                <table><thead><tr><th data-probe="markdown-th">Name</th></tr></thead><tbody><tr><td data-probe="markdown-td">Value</td></tr></tbody></table></div>
            <div class="w-table"><table><thead><tr><th data-probe="table-th">Field</th></tr></thead><tbody><tr><td data-probe="table-td">Value</td></tr></tbody></table></div>
            <label>Widget field <input class="w-input" data-probe="input" value="Readable input"></label>
            <button type="button" class="w-btn" data-probe="button">Cancel</button><button type="button" class="w-btn" data-tone="primary" data-probe="primary">Send</button>
            <div class="bg-base-100 text-base-content border border-ui-border" data-probe="legacy-document">Legacy document</div>
            <div class="bg-base-200 text-base-content" data-probe="legacy-chat">Legacy conversation</div>
            <div class="bg-base-300 text-base-content" data-probe="legacy-hover">Legacy secondary surface</div>
            <div class="bg-bg-content text-text-primary" data-probe="legacy-names">Historical utility names</div>
            <p class="text-base-content" data-probe="legacy-text">Legacy text on the local widget surface</p>
            <p class="text-text-primary" data-probe="legacy-old-text">Historical text on the local widget surface</p>
            <div class="bg-base-100" data-probe="legacy-surface">Inherited local ink on a legacy surface</div>
            <input aria-label="Legacy field" class="input" data-probe="legacy-input" value="Legacy control">
            <button type="button" class="ui-button ui-button--default" data-probe="legacy-button">Cancel</button>
            <button type="button" class="ui-button ui-button--primary" data-probe="legacy-primary">Send</button>
            <button type="button" class="bg-primary text-primary-content" data-probe="utility-primary">Primary utility</button>
            <article class="prose" data-probe="prose"><h2 data-probe="prose-heading">Legacy heading</h2><p data-probe="prose-text">Readable legacy text with <strong data-probe="prose-strong">emphasis</strong> and <a href="#" data-probe="prose-link">a link</a>.</p>
                <p><code data-probe="prose-inline">answer</code></p><blockquote data-probe="prose-quote">A quotation</blockquote>
                <table><thead><tr><th data-probe="prose-th">Name</th></tr></thead><tbody><tr><td data-probe="prose-td">Value</td></tr></tbody></table>
                <pre data-probe="prose-pre"><code data-probe="prose-code">plain code</code></pre><div data-probe="prose-shiki">${code}</div></article>
        </div><form class="w-composer" data-probe="composer"><div class="w-composer-box"><textarea aria-label="Message" rows="1" data-probe="textarea">A readable draft</textarea><div class="w-composer-bar"><button type="button" class="w-btn" data-tone="primary">Send</button></div></div></form></section>`;
    const preview = (id: string, children = "") => `<section class="theme-fixture" data-scope="${id}" data-w-theme="${scopeThemes[id]}">${sample()}${children}</section>`;
    fixture = `<main class="theme-fixture" data-scope="root">${sample()}
        ${preview("dark", preview("dark-light") + preview("dark-contrast"))}
        ${preview("light", preview("light-dark"))}
        ${preview("contrast", preview("contrast-dark") + preview("contrast-light"))}</main>`;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => {
        const url = new URL(request.url);
        const css = paths.get(url.pathname);
        if (css) return new Response(Bun.file(css), { headers: { "content-type": "text/css" } });
        if (url.pathname === "/ui/theme.js") return new Response(Bun.file(join(import.meta.dir, "../ui/$script_theme.js")), { headers: { "content-type": "text/javascript" } });
        if (url.pathname !== "/") return new Response("Not found", { status: 404 });
        const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
        return new Response(`<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="/ui/theme.js"></script><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/w.css">
            <style>.theme-fixture { margin: 8px; min-width: 0; } .theme-fixture > .w-pane { height: auto; } .theme-fixture .w-pane-body { padding: 8px; } .theme-fixture .w-markdown, .theme-fixture .prose { max-width: 100%; }</style>
            </head><body class="bg-base-200 text-base-content text-sm">${fixture}</body></html>`, { headers: { "content-type": "text/html" } });
    } });
    origin = `http://127.0.0.1:${server.port}`;
}, 90_000);
afterAll(() => server?.stop(true));

async function openTab(theme: "light" | "dark", width: number) {
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
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
        pending.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async (expression: string) => {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result?.value;
    };
    const close = async () => {
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Tab closed")); }
        pending.clear();
        ws.close();
        await fetch(`${CDP}/json/close/${target.id}`);
    };
    try {
        await send("Page.enable");
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
        // Explicit app theme must beat the opposite system preference.
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme === "dark" ? "light" : "dark" }] });
        await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('hyper-theme', ${JSON.stringify(theme)});` });
        await send("Page.navigate", { url: `${origin}/?theme=${theme}` });
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) {
            if (await evaluate("document.readyState === 'complete' && !!window.hyperTheme && document.querySelectorAll('link[rel=stylesheet]').length === 2 && [...document.querySelectorAll('link[rel=stylesheet]')].every(link => link.sheet?.cssRules.length > 0)")) { ready = true; break; }
            await Bun.sleep(20);
        }
        if (!ready) throw new Error("Compiled theme stylesheets did not load");
        return { evaluate, close };
    } catch (error) { await close(); throw error; }
}

// Runs in Chrome, not Bun: the canvas normalizes rgb/oklab/color-mix into sRGB, and
// transparent backgrounds are composited over ancestors before calculating WCAG contrast.
const snapshot = `(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); const p = [...context.getImageData(0, 0, 1, 1).data]; return [p[0], p[1], p[2], p[3] / 255]; };
    const over = (fg, bg) => { const a = fg[3] + bg[3] * (1 - fg[3]); return a ? [0, 1, 2].map(i => (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / a).concat(a) : [0, 0, 0, 0]; };
    const background = element => { let out = [0, 0, 0, 0]; for (let e = element; e; e = e.parentElement) { out = over(out, rgba(getComputedStyle(e).backgroundColor)); if (out[3] === 1) break; } return over(out, [255, 255, 255, 1]); };
    const luminance = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const sample = e => { const css = getComputedStyle(e), color = rgba(css.color), bg = background(e), foreground = over(color, bg); const a = luminance(foreground), b = luminance(bg); return { color, background: rgba(css.backgroundColor), effectiveBackground: bg, border: rgba(css.borderBottomColor), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), scheme: css.colorScheme, width: e.getBoundingClientRect().width }; };
    const scopes = [...document.querySelectorAll('[data-scope]')].map(scope => {
        const samples = {};
        for (const element of scope.querySelectorAll('[data-probe]')) if (element.closest('[data-scope]') === scope) samples[element.dataset.probe] = sample(element);
        for (const kind of ['markdown', 'prose']) {
            const host = [...scope.querySelectorAll('[data-probe="' + kind + '-shiki"]')].find(e => e.closest('[data-scope]') === scope);
            const pre = host.querySelector('.shiki'), token = pre.querySelector('code .line span');
            samples[kind + '-shiki-pre'] = sample(pre); samples[kind + '-shiki-token'] = sample(token);
            samples[kind + '-shiki-token'].shiki = Object.fromEntries(['light', 'dark', 'contrast'].map(t => [t, rgba(getComputedStyle(token).getPropertyValue('--shiki-' + t))]));
        }
        const css = getComputedStyle(scope), tokens = {};
        for (const name of ['surface-document', 'surface-chat', 'surface-chrome', 'hover', 'ink', 'ink-muted', 'on-ink', 'border', 'border-control']) tokens[name] = rgba(css.getPropertyValue('--w-' + name));
        return { id: scope.dataset.scope, theme: scope.dataset.wTheme || document.documentElement.dataset.theme, samples, tokens };
    });
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cssCount: document.querySelectorAll('link[rel=stylesheet]').length, body: sample(document.body), scopes };
})()`;

function same(actual: RGB, expected: RGB): boolean { return actual.every((v, i) => Math.abs(v - expected[i]!) <= (i === 3 ? .01 : 1)); }
function paletteProblems(data: Snapshot): string[] {
    const problems: string[] = [];
    const check = (label: string, actual: RGB, expected: RGB) => { if (!same(actual, expected)) problems.push(`${label}: got ${actual}, expected ${expected}`); };
    const foregrounds: Record<string, string> = {
        pane: "ink", header: "ink", chat: "ink", user: "on-ink", markdown: "ink", "markdown-heading": "ink", "markdown-text": "ink", "markdown-inline": "ink", "markdown-th": "ink", "markdown-td": "ink",
        "table-th": "ink-muted", "table-td": "ink", input: "ink", button: "ink", primary: "on-ink", composer: "ink", textarea: "ink",
        "legacy-document": "ink", "legacy-chat": "ink", "legacy-hover": "ink", "legacy-names": "ink", "legacy-text": "ink", "legacy-old-text": "ink", "legacy-surface": "ink", "legacy-input": "ink", "legacy-button": "ink", "legacy-primary": "on-ink", "utility-primary": "on-ink",
        prose: "ink", "prose-heading": "ink", "prose-text": "ink", "prose-strong": "ink", "prose-inline": "ink", "prose-quote": "ink", "prose-th": "ink", "prose-td": "ink", "prose-pre": "ink", "prose-code": "ink",
    };
    const backgrounds: Record<string, string> = {
        pane: "surface-document", header: "surface-chrome", chat: "surface-chat", user: "ink", input: "surface-document", button: "surface-document", primary: "ink", composer: "surface-document", textarea: "surface-document",
        "markdown-inline": "hover", "markdown-th": "surface-chrome", "table-th": "surface-chrome", "legacy-document": "surface-document", "legacy-chat": "surface-chat", "legacy-hover": "hover", "legacy-names": "surface-document",
        "legacy-input": "surface-document", "legacy-button": "surface-document", "legacy-surface": "surface-document", "legacy-primary": "ink", "utility-primary": "ink", "prose-pre": "surface-chat",
    };
    for (const scope of data.scopes) {
        for (const [probe, token] of Object.entries(foregrounds)) check(`${scope.id}/${probe}/color`, scope.samples[probe]!.color, scope.tokens[token]!);
        for (const [probe, token] of Object.entries(backgrounds)) check(`${scope.id}/${probe}/background`, scope.samples[probe]!.effectiveBackground, scope.tokens[token]!);
        for (const probe of ["input", "button", "legacy-input", "legacy-button"]) check(`${scope.id}/${probe}/border`, scope.samples[probe]!.border, scope.tokens["border-control"]!);
        check(`${scope.id}/legacy-document/border`, scope.samples["legacy-document"]!.border, scope.tokens.border!);
        const expectedScheme = scope.theme === "dark" ? "dark" : "light";
        for (const probe of ["input", "textarea", "markdown-shiki-token", "prose-shiki-token"]) {
            if (scope.samples[probe]!.scheme !== expectedScheme) problems.push(`${scope.id}/${probe}/scheme: ${scope.samples[probe]!.scheme}, expected ${expectedScheme}`);
        }
    }
    check("body/background", data.body.background, data.scopes[0]!.tokens["surface-chat"]!);
    check("body/color", data.body.color, data.scopes[0]!.tokens.ink!);
    return problems;
}

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
    test.skipIf(!CDP)(`${theme} ${width}px: actual widget/legacy palettes stay local in nested previews`, async () => {
        const tab = await openTab(theme, width);
        try {
            const data: Snapshot = await tab.evaluate(snapshot);
            expect(data.width).toBe(width);
            expect(data.scrollWidth).toBeLessThanOrEqual(width);
            expect(data.cssCount).toBe(2);
            expect(data.scopes.map(s => s.id)).toEqual(Object.keys(scopeThemes));
            // Guard against a tautological token test: app dark must really select the established w dark palette.
            expect(data.scopes[0]!.tokens["surface-document"]).toEqual(theme === "dark" ? [31, 36, 48, 1] : [255, 255, 255, 1]);
            expect(data.scopes[0]!.tokens.ink).toEqual(theme === "dark" ? [238, 242, 247, 1] : [28, 33, 41, 1]);
            expect(paletteProblems(data)).toEqual([]);
        } finally { await tab.close(); }
    }, 30_000);

    test.skipIf(!CDP)(`${theme} ${width}px: main text and enabled controls retain WCAG 4.5 contrast`, async () => {
        const tab = await openTab(theme, width);
        try {
            const data: Snapshot = await tab.evaluate(snapshot);
            const failures: string[] = [];
            const samples = [{ label: "body", sample: data.body }, ...data.scopes.flatMap(scope => Object.entries(scope.samples)
                // Wrapper divs have no text of their own; Shiki token/pre have separate actual color checks.
                .filter(([name]) => name !== "markdown-shiki" && name !== "prose-shiki")
                .map(([name, sample]) => ({ label: `${scope.id}/${name}`, sample })))];
            for (const { label, sample } of samples) if (sample.contrast < 4.5) failures.push(`${label}: ${sample.contrast.toFixed(2)}:1; text ${sample.color}; background ${sample.effectiveBackground}`);
            const worst = samples.reduce((a, b) => a.sample.contrast < b.sample.contrast ? a : b);
            console.info(`[theme contrast] ${theme} ${width}px: ${samples.length} probes; min ${worst.sample.contrast.toFixed(2)}:1 at ${worst.label}`);
            expect(failures).toEqual([]);
        } finally { await tab.close(); }
    }, 30_000);

    test.skipIf(!CDP)(`${theme} ${width}px: Shiki follows the nearest light/dark/contrast scope after a theme change`, async () => {
        const tab = await openTab(theme, width);
        try {
            for (const switched of [false, true]) {
                if (switched) await tab.evaluate(`window.hyperTheme.set(${JSON.stringify(theme === "dark" ? "light" : "dark")})`);
                const data: Snapshot = await tab.evaluate(snapshot);
                const failures: string[] = [];
                for (const scope of data.scopes) for (const kind of ["markdown", "prose"]) {
                    const token = scope.samples[`${kind}-shiki-token`] as Sample & { shiki: Record<Theme, RGB> };
                    // Legacy prose uses light-dark; widget Markdown additionally supports contrast Shiki tokens.
                    const expectedTheme = kind === "prose" && scope.theme === "contrast" ? "light" : scope.theme;
                    if (!same(token.color, token.shiki[expectedTheme])) failures.push(`${scope.id}/${kind}, switched=${switched}: got ${token.color}; expected ${expectedTheme} ${token.shiki[expectedTheme]}`);
                    if (token.contrast < 4.5) failures.push(`${scope.id}/${kind}, switched=${switched}: unreadable syntax ${token.contrast.toFixed(2)}:1`);
                }
                expect(failures).toEqual([]);
            }
        } finally { await tab.close(); }
    }, 30_000);
}
