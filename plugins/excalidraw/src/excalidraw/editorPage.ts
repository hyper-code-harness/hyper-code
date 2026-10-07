const EXCALIDRAW = "0.18.0";
const REACT = "19.1.0";

/**
 * Renders the standalone Excalidraw editor page for one drawing.
 *
 * The page loads React and Excalidraw from esm.sh, converts a pending skeleton or
 * Mermaid source into elements on first open, autosaves the scene plus an exported
 * SVG preview back through POST /excalidraw/<name> with the session CSRF token.
 * @param opts.name Drawing name.
 * @param opts.scene Current scene JSON, or null for a new drawing.
 * @param opts.csrf CSRF token for the save request; empty on open instances.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Drawing name. */
    name: string;
    /** Current scene JSON, or null for a new drawing. */
    scene: Record<string, unknown> | null;
    /** CSRF token for the save request. */
    csrf: string;
}): Promise<string> {
    const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
    const esc = (s: string) => Bun.escapeHTML(s);
    const ex = `https://esm.sh/@excalidraw/excalidraw@${EXCALIDRAW}`;
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.name)} · Excalidraw</title>
<link rel="stylesheet" href="${ex}/dist/prod/index.css">
<style>
  html, body, #app { margin: 0; height: 100%; }
  #status { position: fixed; right: 12px; bottom: 10px; z-index: 10; font: 12px system-ui; color: #666; background: #fffc; padding: 2px 8px; border-radius: 10px; }
  #status[data-s="err"] { color: #c00; }
  .hyper-full { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 8px; border: 0; background: var(--island-bg-color, #fff); box-shadow: var(--shadow-island, 0 1px 4px #0002); color: var(--icon-fill-color, #1b1b1f); cursor: pointer; text-decoration: none; }
  .hyper-full:hover { background: var(--button-hover-bg, #f1f0ff); }
  .hyper-full svg { width: 18px; height: 18px; }
</style>
<script>window.EXCALIDRAW_ASSET_PATH = "${ex}/dist/prod/";</script>
<script type="importmap">${json({ imports: {
        "react": `https://esm.sh/react@${REACT}`,
        "react/jsx-runtime": `https://esm.sh/react@${REACT}/jsx-runtime`,
        "react-dom": `https://esm.sh/react-dom@${REACT}`,
        "react-dom/client": `https://esm.sh/react-dom@${REACT}/client`,
    } })}</script>
</head><body>
<div id="app"></div><div id="status">загрузка…</div>
<script id="scene" type="application/json">${json(opts.scene)}</script>
<script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToSvg, convertToExcalidrawElements, serializeAsJSON } from "${ex}?external=react,react-dom";

const NAME = ${json(opts.name)}, CSRF = ${json(opts.csrf)};
const status = document.getElementById("status");
const say = (t, s = "") => { status.textContent = t; status.dataset.s = s; };
const scene = JSON.parse(document.getElementById("scene").textContent) || { elements: [], appState: {}, files: {} };

let elements = scene.elements || [];
let converted = false;
try {
  if (scene.hyperMermaid) {
    const { parseMermaidToExcalidraw } = await import("https://esm.sh/@excalidraw/mermaid-to-excalidraw@1.1.2?external=react,react-dom");
    const { elements: sk, files } = await parseMermaidToExcalidraw(scene.hyperMermaid, { themeVariables: { fontSize: "16px" } });
    elements = convertToExcalidrawElements(sk, { regenerateIds: false });
    scene.files = { ...(scene.files || {}), ...(files || {}) };
    converted = true;
  } else if (scene.hyperSkeleton) {
    elements = convertToExcalidrawElements(scene.hyperSkeleton);
    converted = true;
  }
} catch (e) { say("не удалось сконвертировать: " + e.message, "err"); }

let api = null, timer = null, lastSaved = "";
async function save() {
  if (!api) return;
  const els = api.getSceneElements(), app = api.getAppState(), files = api.getFiles();
  const body = serializeAsJSON(els, app, files, "local");
  if (body === lastSaved) return;
  say("сохраняю…");
  try {
    const svgEl = await exportToSvg({ elements: els, appState: { ...app, exportBackground: true, exportWithDarkMode: false }, files, exportPadding: 16 });
    const res = await fetch(location.pathname, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": CSRF },
      body: JSON.stringify({ scene: JSON.parse(body), svg: svgEl.outerHTML }),
    });
    if (!res.ok) throw new Error(res.status + " " + (await res.text()).slice(0, 120));
    lastSaved = body; say("сохранено " + new Date().toLocaleTimeString());
  } catch (e) { say("ошибка сохранения: " + e.message, "err"); }
}
const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 800); };

// Inside the chat iframe: an icon in the top-right corner opens this drawing in a full window.
const EMBEDDED = window.self !== window.top;
const FULL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const openFull = async (e) => { e.preventDefault(); clearTimeout(timer); await save(); window.open(location.pathname, "_blank", "noopener"); };
const renderTopRightUI = () => React.createElement("a", { className: "hyper-full", href: location.pathname, target: "_blank", rel: "noopener", title: "Открыть на весь экран", "aria-label": "Открыть на весь экран", onClick: openFull, dangerouslySetInnerHTML: { __html: FULL_ICON } });

function App() {
  return React.createElement(Excalidraw, {
    excalidrawAPI: (a) => { api = a; if (converted) setTimeout(() => { a.scrollToContent(undefined, { fitToContent: true }); save(); }, 300); else lastSaved = serializeAsJSON(a.getSceneElements(), a.getAppState(), a.getFiles(), "local"); },
    initialData: { elements, appState: { ...(scene.appState || {}), collaborators: undefined }, files: scene.files || {}, scrollToContent: true },
    langCode: "ru-RU",
    onChange: schedule,
    ...(EMBEDDED ? { renderTopRightUI } : {}),
    name: NAME,
  });
}
createRoot(document.getElementById("app")).render(React.createElement(App));
say(converted ? "сконвертировано, сохраняю…" : "готово");
window.addEventListener("beforeunload", () => { clearTimeout(timer); save(); });
</script>
</body></html>`;
}
