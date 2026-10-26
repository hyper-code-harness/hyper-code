/**
 * Render the shared HTML page shell, assets, popup and secure-input host.
 * Use `?presentation=sidebar` for the same chat surface without global navigation
 * or agent Meta at any viewport width. `?embed=1` keeps iframe-preview behavior
 * and takes precedence over sidebar presentation; ordinary pages are unchanged.
 * @param opts Shell content and optional active-agent and document metadata.
 * @param opts.currentId Active agent ID; defaults to the x-hyper-agent request header.
 * @param opts.title Page title prefix; omitted titles use hyper-code2.
 * @param opts.main Trusted rendered HTML for the main page surface.
 * @param opts.headExtra Trusted additional document-head markup; omitted by default.
 */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Identifier of the currently selected agent. */ currentId?: string;
        /** Page title. */ title?: string;
        /** Rendered main-page HTML. */ main: string;
        /** Additional HTML to include in the document head. */ headExtra?: string }): Promise<string> {
    const esc = (s: any) => ctx.fns.w.escape({ text: s });

    // currentId only identifies the active agent to browser-side chat behavior.
    const currentId = opts.currentId ?? session?.req?.headers?.get("x-hyper-agent") ?? undefined;
    const pageTitle = opts.title ? `${opts.title} · hyper-code2` : "hyper-code2";
    const embedded = session?.url?.searchParams.get("embed") === "1";
    const sidebar = !embedded && session?.url?.searchParams.get("presentation") === "sidebar";
    const hideNavigation = embedded || sidebar;
    // The instance can carry its own icon (ui.setFavicon); the built-in one otherwise.
    const favicon = await ctx.fns.ui.faviconUrl({});
    const csrfToken = session?.req ? await ctx.fns.auth.csrfToken({ req: session.req }) : "";
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="csrf-token" content="${esc(csrfToken)}">
<script>(function(){try{var saved=localStorage.getItem('hyper-theme');var theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(_){document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'}})()</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<script>(function(){try{var c=localStorage.getItem('hyper-chrome');document.documentElement.dataset.chrome=c==='cards'?'cards':'flat'}catch(_){document.documentElement.dataset.chrome='flat'}})()</script>
<script>(function(){var m='menu';try{var v=localStorage.getItem('hyper-dock-mode');if(v==='bar'||v==='dot'||v==='menu')m=v}catch(_){}if(m!=='bar')document.documentElement.dataset.dockMode=m;try{var w=parseInt(localStorage.getItem('hyper-dock-panel-w'),10);if(w>=180&&w<=640)document.documentElement.style.setProperty('--dock-panel-w',w+'px')}catch(_){}})()</script>
<title>${esc(pageTitle)}</title>
<link rel="icon" href="${esc(favicon)}">
<!-- htmx 4 (framework bundle). Inheritance stays explicit (htmx 4 default):
     implicit inheritance let hx-trigger="load" leak into child buttons and loop.
     Default 60 s timeout; long actions opt out with hx-config='{"timeout":0}'.
     4xx/5xx HTML is swapped like any answer; non-HTML errors become a toast
     (ui/controlScript).
     morphIgnore "open": a morph keeps the reader's open/closed <details>
     instead of resetting it to whatever the server rendered. -->
<meta name="htmx-config" content='{"morphIgnore":["data-htmx-powered","open"]}'>
<script src="/procs/ui/htmx.js" defer></script>
<link rel="stylesheet" href="/ui/vendor/phosphor.css">
<style>
[data-chat-header]:has([data-agent-running]) .w-chat-icon-ring[data-live] { display: block; }
.glass-panel {
  background-color: rgb(from var(--color-base-100) r g b / .68);
  background-image: linear-gradient(110deg, rgb(255 255 255 / .16), transparent 48%, rgb(255 255 255 / .05));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22), 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .08);
  backdrop-filter: blur(12px) saturate(115%);
  -webkit-backdrop-filter: blur(12px) saturate(115%);
}
/* The top zone scrolls when pins outgrow it; a soft fade at the bottom edge says there is more. */
/* Dock modes (html[data-dock-mode], per device in localStorage 'hyper-dock-mode', ⌘B cycles, /dock/dock.js):
   bar — the icon strip (default); menu — the same strip widened with labels; dot — only the menu circle stays,
   at the very same place, and the page takes the whole width. */
/* Menu: the thin Dock stays; a ChatGPT-like panel with projects and recent chats opens beside it
   (#dock-panel, drawn by dock.panel, loaded on first open and kept live on the agents topic). */
/* One type scale for the whole shell: the same family and smoothing everywhere (the composer's textarea used
   Tailwind's font-sans stack), UI chrome — menu rows, tabs, chat header — at 13px regular, reading text at 14px. */
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
/* Message context menu (right-click on a message, ui/hotkeys.js puts it at the pointer). */
/* Global menu (⌘/), by the interaction principle: hover is grey; the row chosen with ↑ ↓ is selected (palest blue
   backing, blue icon); the search field in focus turns only its edge line blue (as the chat composer does with its top line), so the
   rounded corners of the box are never cut by a ring. */
.dock-panel { display: none; }
.inplace-popup-panel[data-dock-settings-panel] { width: 15rem; }
/* No side panel on a phone or in the browser-sidebar presentation: there is no room for it. */
@media (max-width: 700px) { html[data-dock-mode] .dock-panel { display: none !important; } }
body[data-presentation="sidebar"] .dock-panel { display: none !important; }
html[data-dock-mode="menu"] .dock-panel { display: flex; flex-direction: column; width: var(--dock-panel-w, 16.5rem); flex: none; min-height: 0; height: calc(100% - 1rem); margin: .5rem .25rem .5rem 0; border: 1px solid var(--color-ui-border); border-left: 0; border-radius: 0 1rem 1rem 0; overflow: hidden; background: rgb(from var(--color-base-100) r g b / .68); box-shadow: 0 1px 2px rgb(0 0 0 / .04); }
/* Bar and panel are one card: the bar gives up its right corners and gap, its right border is the divider. */
/* The grey header cell of the bar (in bar and menu mode alike, so opening the panel moves nothing); with the panel it runs across both: the menu circle sits in the bar's part of it, under it the same hairline. */
/* Drag the panel's right edge (/dock/dock.js); the width is per device in localStorage 'hyper-dock-panel-w',
   double click resets it. The strip sits in the 4px gap the panel's right margin already leaves, so showing
   it moves nothing; ::before widens the grab area without widening the strip. */
.dock-panel-resizer { display: none; }
html[data-dock-mode="menu"] .dock-panel-resizer { display: block; flex: 0 0 .25rem; margin-left: -.25rem; position: relative; z-index: 6; cursor: col-resize; touch-action: none; }
.dock-panel-resizer::before { content: ""; position: absolute; inset: 0 -3px; }
.dock-panel-resizer::after { content: ""; position: absolute; inset: .5rem 1px; border-radius: 2px; background: transparent; transition: background .15s; }
.dock-panel-resizer:hover::after, .dock-panel-resizer:focus-visible::after, html.dock-panel-resizing .dock-panel-resizer::after { background: var(--color-primary); }
@media (max-width: 700px) { html[data-dock-mode] .dock-panel-resizer { display: none !important; } }
body[data-presentation="sidebar"] .dock-panel-resizer { display: none !important; }
html.dock-panel-resizing, html.dock-panel-resizing body { user-select: none; cursor: col-resize; }
html.dock-panel-resizing iframe { pointer-events: none; }
.dock-panel-row[aria-current="page"], #dock-panel .nav-row[aria-current="page"] { background: color-mix(in oklab, var(--color-base-content) 7%, transparent); color: var(--color-base-content); }
#dock-panel .nav-row[aria-current="page"] > span { color: var(--color-base-content); font-weight: 500; }
.dock-panel-project[open] > summary { color: var(--color-base-content); }
/* Dot: the strip goes away and the menu circle moves into the top row of the page — the canvas tab row
   (h-8, inside a panel with my-2 ml-2) or the chat header — which makes room for it on the left. */
/* The circle's slot mirrors the right end of the tab row (history, reload, close): a cell with a bottom border
   and a hairline towards the tabs; the circle itself looks like those buttons. */
html[data-dock-mode="dot"] [data-page="agent"]:not([data-canvas-open]) #chat-panel > header { padding-left: 2.75rem !important; }
html[data-dock-mode="dot"] #main:not(:has(> [data-page="agent"])) { padding-left: 2.75rem; }
/* Hovered (or holding focus / an open popover) the circle unfolds into the whole bar over the page, the circle
   staying where it was; the pin button in it keeps the bar for good. */
.glass-panel {
  box-shadow: inherit;
}

.glass-bar {
  background-color: rgb(from var(--color-base-100) r g b / .68) !important;
  background-image: linear-gradient(110deg, rgb(255 255 255 / .12), transparent 45%, rgb(255 255 255 / .04));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22), 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .08);
  backdrop-filter: blur(12px) saturate(115%);
  -webkit-backdrop-filter: blur(12px) saturate(115%);
}
#chat-panel { position: relative; container: chat / inline-size; }
/* The conversation sits on a soft grey (a touch lighter than the headers), so white things on it — the
   composer, tool pills, menus — read as surfaces. */
:root { --chat-bg: color-mix(in oklab, var(--color-base-200) 30%, var(--color-base-100)); }
/* Beside an open canvas the chat reads as a side conversation, not a second document: a slightly deeper grey,
   a shade of depth along the canvas edge, and a smaller type (13px) than the canvas page. */
[data-page="agent"][data-canvas-open]:not([data-chat-collapsed]) > #chat-panel { --chat-bg: color-mix(in oklab, var(--color-base-200) 50%, var(--color-base-100)); }
[data-page="agent"][data-canvas-open]:not([data-chat-collapsed]) > #chat-panel #messages :is(.w-msg, .w-msg .w-markdown) { font-size: 13px; line-height: 1.55; }
[data-page="agent"][data-canvas-open]:not([data-chat-collapsed]) > #chat-panel #messages .w-markdown :is(h1, h2, h3) { font-size: 14px; }
/* The chat column is a card like the Dock panel and the canvas: rounded border, and on top the same grey 32px
   header row with a hairline under it (instead of the floating pill). Wide screens only; the folded strip and
   the browser-sidebar presentation keep their own looks. */
@media (min-width: 701px) {
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel { margin: .5rem .5rem .5rem 0; border: 1px solid var(--color-ui-border); border-radius: 1rem; overflow: hidden; background: var(--chat-bg); }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-canvas-open]) > #chat-panel { margin-left: .25rem; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) .chat-dot-grid { padding-top: 1rem !important; padding-bottom: 1rem !important; background-image: none; background-color: var(--chat-bg); }
  /* The composer is the card's footer, a mirror of its header: full width, a hairline above, the text field and
     its toolbar flat inside it; focus shows as a thin accent line on top instead of a floating ring. */
  /* Comfortable reading width in a wide column, centred like ChatGPT. */
  /* One reading column, centred, whatever the window: every row — answers, tool pills, the person's messages,
     dividers — is exactly the same width and starts at the same left edge; the composer's text lines up with it. */
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) #messages > * { width: 100%; max-width: 46rem; margin-left: auto !important; margin-right: auto !important; box-sizing: border-box; }
  /* The chat header follows the same column: the icon and name start where the messages start, ⋯ ends where they end. */
  html[data-chrome="flat"] body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > section#chat-panel > header.w-pane-header { padding-left: max(.75rem, calc((100% - 46rem - var(--chat-scrollbar, 0px)) / 2)) !important; padding-right: max(.375rem, calc((100% - 46rem - var(--chat-scrollbar, 0px)) / 2)) !important; }
}
/* Canvas (src/canvas): hidden until the agent page carries data-canvas-open. Then the canvas takes the
 * free space on the left and the chat becomes a --chat-w column on the right. */
[data-page="agent"] > .canvas-panel, [data-page="agent"] > .canvas-resizer { display: none; }
/* Closed canvas = a folded bar like the Dock: a 40px column at the chat's left with the same 32px grey header
   cell (opens the canvas) and one icon per tab (opens it on that tab). Always there, so the canvas can always be
   opened from the same place; empty canvas = just the header cell. */
[data-page="agent"]:not([data-canvas-open]) > .canvas-panel { display: flex !important; flex: 0 0 2.5rem !important; width: 2.5rem !important; margin: 0 !important; border: 0 !important; border-right: 1px solid var(--color-ui-border) !important; border-radius: 0 !important; box-shadow: none !important; background: var(--color-base-200) !important; overflow: hidden; }
@media (max-width: 700px) { [data-page="agent"]:not([data-canvas-open]) > .canvas-panel { display: none !important; } }
[data-page="agent"][data-canvas-open] > .canvas-panel { display: flex; }
[data-page="agent"][data-canvas-open] > .canvas-resizer { display: block; flex: 0 0 8px; cursor: col-resize; position: relative; touch-action: none; }
[data-page="agent"][data-canvas-open] > .canvas-resizer::after { content: ""; position: absolute; inset: 30% 3px; border-radius: 2px; background: var(--color-base-300); transition: background .15s; }
[data-page="agent"][data-canvas-open] > .canvas-resizer:hover::after, [data-page="agent"][data-canvas-open] > .canvas-resizer:focus-visible::after, [data-page="agent"].canvas-resizing > .canvas-resizer::after { background: var(--color-primary); }
[data-page="agent"][data-canvas-open] > #chat-panel { flex: 0 0 var(--chat-w, 440px); width: var(--chat-w, 440px); max-width: calc(100% - 400px); }
[data-page="agent"][data-canvas-open] { position: relative; }
/* Collapsed chat (canvas_state.chat_collapsed, ⌘\ — canvas.toggleChat): the canvas takes the whole page and the
   chat floats over its bottom as a strip — the composer and, above it, the latest message. Hovering or focusing
   the strip shows a little more of the conversation; the header button / ⌘\ brings the column back. */
[data-page="agent"][data-canvas-open][data-chat-collapsed] > .canvas-resizer { display: none; }
[data-page="agent"][data-canvas-open][data-chat-collapsed] > .canvas-panel { margin-right: .5rem; }
[data-page="agent"][data-canvas-open][data-chat-collapsed] > #chat-panel {
  position: absolute; z-index: 44; left: 50%; bottom: 1rem; transform: translateX(-50%);
  width: min(44rem, calc(100% - 3rem)); max-width: none; flex: none; height: auto; max-height: 8.5rem;
  border: 1px solid var(--color-ui-border); border-radius: .75rem; overflow: hidden;
  background: rgb(from var(--color-base-100) r g b / .96); box-shadow: 0 10px 36px rgb(0 0 0 / .16);
  backdrop-filter: blur(16px) saturate(115%); -webkit-backdrop-filter: blur(16px) saturate(115%);
  transition: max-height .18s ease;
}
[data-page="agent"][data-canvas-open][data-chat-collapsed] > #chat-panel:is(:hover, :focus-within) { max-height: min(24rem, 55vh); }
[data-page="agent"][data-chat-collapsed] > #chat-panel > header { position: absolute; top: .35rem; right: .5rem; left: auto; width: auto !important; margin: 0 !important; padding: 0 !important; background: none; border: 0; box-shadow: none; z-index: 2; }
[data-page="agent"][data-chat-collapsed] > #chat-panel > header > :not(.w-pane-actions), [data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-chat-badges] { display: none !important; }
[data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-chat-buttons] > :not([data-chat-id="canvas.collapse"]) { display: none !important; }
[data-page="agent"][data-chat-collapsed] #messages > * { max-width: none; }
/* Folded strip as a slide: only the latest answer of the agent, no tool calls, no other messages, no scrolling —
   a new answer replaces the old one. Long answers are cut with a fade; hovering the strip lets it grow. */
[data-page="agent"][data-chat-collapsed] #messages { overflow: hidden !important; display: flex; flex-direction: column; justify-content: flex-end; }
[data-page="agent"][data-chat-collapsed] #messages > * { display: none !important; }
/* The latest message, whoever wrote it: right after sending you see your own message, and the answer replaces it. */
[data-page="agent"][data-chat-collapsed] #messages > .w-msg:not(:has(~ .w-msg)) { display: flex !important; flex: none; }
[data-page="agent"][data-chat-collapsed] #messages > .w-msg > .w-avatar { display: none; }
[data-page="agent"][data-chat-collapsed] #messages .w-msg[data-role="user"] .w-msg-body { max-height: 5.5rem; overflow: hidden; }
[data-page="agent"][data-chat-collapsed] #messages > .w-msg[data-role="agent"] .w-msg-body { max-height: 5.5rem; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent); mask-image: linear-gradient(to bottom, #000 60%, transparent); }
[data-page="agent"][data-chat-collapsed] > #chat-panel:is(:hover, :focus-within) #messages > .w-msg[data-role="agent"] .w-msg-body { max-height: min(18rem, 45vh); overflow-y: auto; -webkit-mask-image: none; mask-image: none; }
[data-page="agent"][data-chat-collapsed] #messages .chat-tools { display: none !important; }
/* Resized from its top-left corner (ui/hotkeys.js): --strip-w/--strip-h; the answer then fills the strip. */
[data-page="agent"][data-canvas-open][data-chat-collapsed] > #chat-panel[data-strip-sized] { width: var(--strip-w) !important; height: var(--strip-h) !important; max-height: none !important; }
[data-page="agent"][data-chat-collapsed] > #chat-panel[data-strip-sized] #messages > .w-msg .w-msg-body { max-height: none !important; overflow: hidden; -webkit-mask-image: none; mask-image: none; }
[data-page="agent"][data-chat-collapsed] > #chat-panel::after { content: ""; position: absolute; z-index: 3; top: 3px; left: 3px; width: 9px; height: 9px; border-top: 2px solid var(--color-ui-border); border-left: 2px solid var(--color-ui-border); border-top-left-radius: 4px; cursor: nwse-resize; }
[data-page="agent"][data-chat-collapsed] > #chat-panel:hover::after { border-color: color-mix(in oklab, var(--color-base-content) 35%, transparent); }
/* Moved by dragging its top edge (ui/hotkeys.js); --strip-x/--strip-y are kept per device. */
[data-page="agent"][data-canvas-open][data-chat-collapsed] > #chat-panel[data-strip-moved] { left: var(--strip-x) !important; top: var(--strip-y) !important; bottom: auto !important; transform: none !important; }
[data-page="agent"][data-chat-collapsed] > #chat-panel::before { content: ""; position: absolute; z-index: 3; top: 0; left: 50%; width: 2.5rem; height: 4px; margin: 4px 0 0 -1.25rem; border-radius: 9999px; background: var(--color-ui-border); cursor: grab; }
/* Folded strip input: just the text and send/stop on one line — no attach, model, effort or meters. */
/* One line: [+] text [send/stop]. The toolbar row's box is dissolved (display: contents) so its + goes before
   the text and send after it; model, effort and meters are hidden. */
/* The folded strip is one tight card: the messages above, then the composer flush with its edges (no box in a
   box) behind a hairline; the toolbar row is compact. */
[data-page="agent"][data-chat-collapsed] #messages { background: none !important; padding: .5rem 3rem .25rem .875rem !important; flex: 1 1 auto; min-height: 0; }
html [data-page="agent"][data-chat-collapsed] > #chat-panel > header.w-pane-header { height: auto !important; min-height: 0 !important; background: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; padding: 0 !important; position: absolute; top: .375rem !important; right: .375rem !important; left: auto; z-index: 2; }
html [data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-canvas-chat-toggle] { width: 1.75rem !important; height: 1.75rem !important; border-radius: 9999px !important; background: none; color: color-mix(in oklab, var(--color-base-content) 45%, transparent); }
html [data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-canvas-chat-toggle]:hover { background: color-mix(in oklab, var(--color-base-content) 7%, transparent); color: var(--color-base-content); }
[data-page="agent"].canvas-resizing { user-select: none; cursor: col-resize; }
[data-page="agent"].canvas-resizing iframe { pointer-events: none; }
/* Narrow window: the canvas covers the whole page; the chat stays mounted underneath. */
@media (max-width: 1023px) {
  [data-page="agent"][data-canvas-open] > .canvas-panel { position: absolute; inset: 0; z-index: 45; margin: .5rem; }
  [data-page="agent"][data-canvas-open] > .canvas-resizer { display: none; }
  [data-page="agent"][data-canvas-open] > #chat-panel { flex: 1 1 auto; width: auto; max-width: none; }
}
/* The chat header adapts to the CHAT column, not the window: with the Meta
 * panel open a 1000px window leaves the chat ~420px, and the full action row
 * (effort, compact, prompt, share, fork, info, archive, delete) spilled out of
 * the glass bar over the Meta panel's toggle. Below 560px the secondary actions
 * fold away (they stay in the agent page / Meta), below 420px the workspace and
 * token count go too, so the title keeps real room. */
@container chat (max-width: 560px) {
  #chat-panel > header { gap: .4rem; padding-right: .75rem; }
  /* Badges other than the status fold away; the panel (⋯) has everything they offered. */
  #chat-panel > header [data-chat-badges] > :not([data-chat-id="agent.status"]) { display: none !important; }
  #chat-panel > header [data-chat-buttons] > :not([data-chat-id="agent.effort"]) { display: none !important; }
}
@container chat (max-width: 420px) {
  #chat-panel > header [data-chat-buttons], #chat-panel > header [data-chat-badges] > :not([data-chat-id="agent.status"]) { display: none !important; }
}
.dot-grid-surface {
  background-color: var(--color-base-200);
  background-image: radial-gradient(circle, color-mix(in oklab, var(--color-base-content) 9%, transparent) 0 1px, transparent 1.35px);
  background-position: 8px 8px;
  background-size: 16px 16px;
  background-attachment: local;
}

.chat-dot-grid { padding-top: 1rem !important; padding-bottom: 1rem !important; }
.chat-dot-grid > * {
  width: 100%;
  max-width: 48rem;
  margin-left: auto !important;
  margin-right: auto !important;
}



@media (max-width: 700px) {
  html, body, #frame { width: 100%; height: 100dvh; min-height: 0; overflow: hidden; }
  body { -webkit-text-size-adjust: 100%; overscroll-behavior: none; }
  #dock { display: none !important; }
  #page-view { width: 100%; height: 100dvh; min-height: 0; overflow: hidden; }
  /* #main is the page scroller: with overflow hidden every ordinary page on a
   * phone showed only its first screen. The chat page keeps its own inner
   * scroller (#messages), so it opts out below. */
  #main { width: 100%; height: 100dvh; min-height: 0; overflow-x: hidden; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  #main:has(> [data-page="agent"]) { overflow: hidden; }
  /* The floating menu button sits over the page's top-left corner; ordinary
   * pages start below it so it never covers a title or a breadcrumb. */
  #main:not(:has(> [data-page="agent"])) { padding-top: calc(env(safe-area-inset-top) + 3.25rem); }
  #mobile-nav-button { display: inline-flex !important; position: fixed; z-index: 49; top: max(.4rem, env(safe-area-inset-top)); left: .5rem; width: 2.75rem; height: 2.75rem; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid var(--color-ui-border); background: rgb(from var(--color-base-100) r g b / .82); color: color-mix(in oklab, var(--color-base-content) 72%, transparent); box-shadow: inset 0 1px 0 rgb(255 255 255 / .25), 0 5px 18px rgb(0 0 0 / .14); backdrop-filter: blur(16px) saturate(120%); -webkit-backdrop-filter: blur(16px) saturate(120%); touch-action: manipulation; }
  #mobile-nav-button:active { transform: scale(.94); }
  #chat-panel > header { padding-left: 3.1rem !important; }
  #nav-overlay { padding: max(.5rem, env(safe-area-inset-top)) .5rem max(.5rem, env(safe-area-inset-bottom)); }
  #nav-overlay [data-nav-row] { min-height: 3rem; }
  [data-page="agent"] { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
  #chat-panel { width: 100%; min-width: 0; }
  button, a, select, input[type="checkbox"], input[type="radio"] { touch-action: manipulation; }
  #chat-panel > header button:not(.hidden), #chat-panel > header a:not(.hidden) { min-width: 2.25rem; min-height: 2.25rem; display: inline-flex; align-items: center; justify-content: center; }
  #chat-panel > header select { min-height: 2.25rem; }

  #chat-panel > header [data-chat-buttons], #chat-panel > header [data-chat-badges] > :not([data-chat-id="agent.status"]) { display: none !important; }
  #messages, #messages > *, #messages .w-msg-body { min-width: 0; max-width: 100%; }
  #messages { overflow-x: hidden !important; }
  #messages [data-load-older] { min-height: 2.75rem; padding-inline: 1rem; }

  #messages .sr-only { width: 1px !important; max-width: 1px !important; overflow: hidden !important; white-space: nowrap !important; }

  #messages .group > .relative > .absolute { display: none !important; }

  #messages [class*="max-w-"] { min-width: 0; }
  #messages .prose, #messages p, #messages li, #messages td, #messages th { overflow-wrap: anywhere; word-break: break-word; }
  #messages pre, #messages .shiki { max-width: 100%; overflow-x: auto !important; overflow-wrap: normal; word-break: normal; }
  #messages img, #messages video, #messages svg, #messages table { max-width: 100%; }
  #messages table { display: block; overflow-x: auto; }

  .chat-dot-grid { padding: 1rem .5rem !important; }
  .chat-dot-grid > * { max-width: 100% !important; }
  #app-popup { width: calc(100vw - 1rem) !important; max-height: calc(100dvh - 1rem) !important; }
  /* On a phone the composer owns the bottom; toasts drop from the top, under the header. */
  #toasts { top: calc(env(safe-area-inset-top) + 3.5rem) !important; bottom: auto !important; right: .5rem !important; left: .5rem; align-items: stretch !important; flex-direction: column !important; }
  #app-popup > div { max-height: calc(100dvh - 1rem) !important; }
}


/* Sidebar presentation reuses the page and live chat, independent of viewport. */
body[data-presentation="sidebar"] #dock,
body[data-presentation="sidebar"] #mobile-nav-button,
body[data-presentation="sidebar"] #nav-overlay { display: none !important; }
body[data-presentation="sidebar"] #chat-panel > header { padding-left: .55rem !important; }

/* Flat chrome (html[data-chrome="flat"], the default; localStorage hyper-chrome = "cards" brings the rounded
   cards back): the page is ruled into panes by 1px lines — no gaps, no radii, no shadows — like an editor.
   Bar | side panel | canvas | chat sit edge to edge; every pane's first row is the same 32px grey header, so
   the headers read as one strip across the window. Floating things (popovers, the folded chat strip, the
   Dock unfolded from its circle) keep their own rounded look. */
@media (min-width: 701px) {
  html[data-chrome="flat"] #frame { background: var(--color-base-100); }
  html[data-chrome="flat"] .dock-panel,
  html[data-chrome="flat"] [data-page="agent"] > .canvas-panel,
  html[data-chrome="flat"] body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel {
    margin: 0 !important; height: 100% !important; border-radius: 0 !important; box-shadow: none !important;
    border: 0 !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
  }
  html[data-chrome="flat"][data-dock-mode="menu"] .dock-panel { border-right: 1px solid var(--color-ui-border) !important; background: var(--color-base-200) !important; }
  html[data-chrome="flat"] [data-page="agent"] { background: var(--color-base-100) !important; }
  html[data-chrome="flat"] [data-page="agent"][data-canvas-open] > .canvas-panel { background: var(--color-base-100) !important; }
  /* The resizer is the line between canvas and chat: zero width, a wider invisible grab area. */
  html[data-chrome="flat"] [data-page="agent"][data-canvas-open]:not([data-chat-collapsed]) > .canvas-resizer { flex: 0 0 1px !important; background: var(--color-ui-border); z-index: 5; }
  html[data-chrome="flat"] [data-page="agent"][data-canvas-open] > .canvas-resizer::before { content: ""; position: absolute; inset: 0 -4px; cursor: col-resize; }
  html[data-chrome="flat"] [data-page="agent"][data-canvas-open] > .canvas-resizer::after { inset: 0; border-radius: 0; background: transparent; }
  html[data-chrome="flat"] [data-page="agent"][data-canvas-open] > .canvas-resizer:hover, html[data-chrome="flat"] [data-page="agent"].canvas-resizing > .canvas-resizer { background: var(--color-primary); }
  html[data-chrome="flat"] [data-page="agent"]:not([data-canvas-open]) > #chat-panel { margin-left: 0 !important; }
  html[data-chrome="flat"] #page-view { background: var(--color-base-100); }
  /* One header system for every pane (side panel, canvas tabs, chat): 32px, the same grey, 13px titles —
     medium for the pane's own name, regular for tabs —, 12px muted secondary text, and every icon button the
     same 28px square with a 15px icon in the same grey. */
  /* The side panel's first row under its header lines up with the address row. */
  /* One place says "running": a turning arc around the stop button in the composer. The header's icon ring stays still. */
  html[data-chrome="flat"] #chat-panel > header .w-chat-icon-ring { display: none !important; }
  /* Headers: one small type everywhere — 12px, medium for names, regular for tabs. */
  /* Fewer things in the composer: the quiet prompt-inject icon lives in the ⋯ panel (a non-default prompt inject
     still shows as its chip above the text). The context ring always stays in the composer. */
  html[data-chrome="flat"] #form .w-composer-meters > [data-chat-part="prompt-inject"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  html[data-chrome="flat"] #chat-panel > header [data-chat-id="agent.inspector"] { display: none !important; }
  /* Canvas buttons live with the canvas (its bar or its header); the chat header keeps the name and ⋯ only.
     The folded strip keeps its own unfold button. */
  html[data-chrome="flat"] #chat-panel > header :is([data-chat-id="canvas.toggle"], [data-chat-id="canvas.collapse"]) { display: none !important; }
  html[data-chrome="flat"] [data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-chat-id="canvas.collapse"] { display: flex !important; }
  /* The canvas bar's line towards the chat (the flat rule above clears every pane border). */
  html[data-chrome="flat"] [data-page="agent"]:not([data-canvas-open]) > .canvas-panel { border-right: 1px solid var(--color-ui-border) !important; }
  /* One grey scale for the shell, three steps only:
       chrome  = base-200  — bars, side panel, every header row, inactive tabs
       chat    = --chat-bg — the conversation (between chrome and white)
       surface = base-100  — documents: canvas page, active tab, address row, composer, pills, menus
     The chat header and inactive canvas tabs used base-300 at 60% (a darker, slightly different grey). */
}
</style>

<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .shiki { background: transparent !important; }
  .tool pre.shiki { padding: 0; margin: 0; overflow-x: auto; }
  .ui-toggle-track { position: relative; display: block; flex: none; width: 40px; height: 20px; box-sizing: border-box; border-radius: 9999px; background: rgb(229 231 235); transition: background-color .15s ease, box-shadow .15s ease; }
  .ui-toggle-thumb { position: absolute; top: 2px; display: block; width: 16px; height: 16px; border-radius: 9999px; background: white; box-shadow: 0 1px 2px rgb(0 0 0 / .18); transition: left .15s ease; }
  .ui-toggle-input:focus-visible + span.ui-toggle-track { box-shadow: 0 0 0 2px rgb(199 210 254); }

  #app-popup[data-popup-kind="file-preview"] { width: min(90rem, calc(100vw - 2rem)) !important; height: 97vh !important; max-height: 97vh !important; }
  #app-popup[data-popup-kind="file-preview"] > div { height: 100%; max-height: 100% !important; }
  #app-popup[data-popup-kind="file-preview"] .app-popup-body { overflow: hidden !important; padding: 0 !important; }

</style>
${((ctx.state as any).procs?.styles ?? []).map((st: any) => `<link rel="stylesheet" href="${esc(st.href)}">`).join("\n")}
${opts.headExtra ?? ""}
<!-- client.js first: every later script subscribes through window.hyperLive (docs/live-updates.md). -->
<script src="/procs/events/client.js" defer></script>
<script src="/ui/control.js" defer></script>
<script src="/ui/hotkeys.js?v=7" defer></script>
<script src="/ui/rpc.js?v=6" defer></script>
<script src="/agent/chat.js" defer></script>
<script src="/ui/popup.js" defer></script>
<script src="/chat/header.js" defer></script>
<script src="/ui/meta.js" defer></script>
<script src="/screen/client.js" defer></script>
<script src="/ui/wake-timer.js" defer></script>
<script src="/ui/spin-sync.js" defer></script>
<script src="/ui/tool-timer.js?v=3" defer></script>
</head>
<body class="bg-base-200 text-base-content text-sm h-screen${embedded ? " overflow-hidden" : ""}"${currentId ? ` data-agent-id="${esc(currentId)}"` : ""}${sidebar ? ' data-presentation="sidebar"' : ""}>
<div id="frame" class="relative flex h-screen">
  ${hideNavigation ? "" : ctx.fns.w.pressable({ html: '<i class="ph ph-squares-four text-xl" aria-hidden="true"></i>', label: "Open agents and pages", title: "Agents and pages", marks: { action: "open-global-menu-mobile" }, attrs: { id: "mobile-nav-button", onclick: "window.__navOpen?.()" }, class: "hidden" })}
  ${hideNavigation ? "" : await ctx.fns.dock.render({})}
  ${hideNavigation ? "" : ctx.fns.ui.live({ id: "dock-panel", url: "/dock/panel", topic: "agents", every: 120, tag: "aside", swap: "innerHTML", trigger: "load[document.documentElement.dataset.dockMode==='menu'], dock-panel-load", attrs: 'aria-label="Projects and chats" class="dock-panel"' })}
  ${hideNavigation ? "" : '<div class="dock-panel-resizer" data-dock-panel-resizer tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize the projects and chats panel" title="Drag to resize · double click to reset"></div>'}
    <script src="/canvas/canvas.js?v=3" defer></script>
  <!-- This container owns no navigation attributes: live descendants must
       always target themselves, while navigation is handled by the global menu. -->
  <section id="page-view" class="flex min-w-0 flex-1 flex-col bg-base-100">
    <main id="main" hx-history-elt class="min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto">${opts.main}</main>
  </section>
</div>
${embedded ? "" : `<dialog id="app-popup" class="m-auto max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ui-border bg-base-100 p-0 text-base-content shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[1px]">
  <div class="flex max-h-[85vh] flex-col">
    <div class="flex shrink-0 items-center gap-3 border-b border-ui-border px-5 py-3.5"><h2 id="app-popup-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-muted">Details</h2>${ctx.fns.w.pressable({ html: '<i class="ph ph-x text-lg"></i>', label: "Close", marks: { action: "close-popup" }, attrs: { id: "app-popup-close" }, class: "flex size-8 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-base-content" })}</div>
    <div id="app-popup-body" class="app-popup-body min-h-0 flex-1 overflow-auto bg-base-200/60 p-5 text-xs text-muted"></div>
  </div>
</dialog>
${hideNavigation ? "" : ctx.fns.ui.navMenu({})}`}
${ctx.fns.w.pressable({ html: "", label: "Secure input", marks: { action: "secure-input" }, attrs: { id: "secure-input-host", "hx-popup": "secureInput.current", "data-pending": (ctx.state as any).secureInput?.prompts?.size ? '1' : '0' }, class: "hidden" })}

${embedded ? `<script>document.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();window.parent.postMessage({type:'ui.close-popup'},location.origin)}})</script>` : `<script>window.addEventListener('message',function(event){if(event.origin!==location.origin||event.data?.type!=='ui.close-popup')return;var dialog=document.getElementById('app-popup');if(dialog?.open)dialog.close()})</script>`}

</body>
</html>`;
}
