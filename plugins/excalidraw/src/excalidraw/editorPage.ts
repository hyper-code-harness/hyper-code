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

// A skeleton gives boxes and arrows only roughly: a label wider than its box wraps
// mid-word and spills out, and an arrow bound by start/end ids keeps the x/y it was
// given instead of joining the shapes. Grow each labelled shape to fit its text
// (measured by Excalidraw itself) around the same centre, then route every arrow
// without explicit points from edge to edge of the shapes it connects.
function layoutSkeleton(input) {
  const sk = input.map((e) => ({ ...e }));
  const shapes = new Map();
  for (const e of sk) if (e.id && e.type !== "arrow" && e.type !== "line") shapes.set(e.id, e);
  for (const e of sk) {
    if (!e.label || !e.label.text || e.type === "arrow" || e.type === "line") continue;
    const [t] = convertToExcalidrawElements([{ type: "text", x: 0, y: 0, text: String(e.label.text), fontSize: e.label.fontSize || 20, fontFamily: e.label.fontFamily }]);
    const tw = t.width * 1.1, th = t.height;
    const k = e.type === "ellipse" ? Math.SQRT2 : e.type === "diamond" ? 2 : 1;
    const needW = Math.ceil(tw * k + 30), needH = Math.ceil(th * k + 20);
    const w0 = e.width ?? 0, h0 = e.height ?? 0;
    if (w0 < needW) { if (e.width != null) e.x = (e.x ?? 0) - (needW - w0) / 2; e.width = needW; }
    if (h0 < needH) { if (e.height != null) e.y = (e.y ?? 0) - (needH - h0) / 2; e.height = needH; }
  }
  // Distance from the centre to the outline along (dx, dy), as a fraction of that vector.
  const reach = (s, dx, dy) => {
    const hw = s.width / 2, hh = s.height / 2;
    if (s.type === "ellipse") return 1 / Math.hypot(dx / hw, dy / hh);
    if (s.type === "diamond") return 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  };
  const GAP = 6;
  for (const a of sk) {
    if ((a.type !== "arrow" && a.type !== "line") || a.points) continue;
    const s = a.start && shapes.get(a.start.id), d = a.end && shapes.get(a.end.id);
    if (!s || !d || s.width == null || d.width == null) continue;
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2, dx0 = d.x + d.width / 2, dy0 = d.y + d.height / 2;
    const vx = dx0 - sx, vy = dy0 - sy, len = Math.hypot(vx, vy);
    if (!len) continue;
    const ux = vx / len, uy = vy / len;
    const r1 = reach(s, vx, vy) * len + GAP, r2 = reach(d, -vx, -vy) * len + GAP;
    if (r1 + r2 >= len) continue;
    const x1 = sx + ux * r1, y1 = sy + uy * r1, x2 = dx0 - ux * r2, y2 = dy0 - uy * r2;
    a.x = x1; a.y = y1; a.width = x2 - x1; a.height = y2 - y1;
    a.points = [[0, 0], [x2 - x1, y2 - y1]];
  }
  return sk;
}

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
    elements = convertToExcalidrawElements(layoutSkeleton(scene.hyperSkeleton));
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
