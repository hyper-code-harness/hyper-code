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
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });

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
<script>(function(){var m='menu';try{var v=localStorage.getItem('hyper-dock-mode');if(v==='bar'||v==='dot'||v==='menu')m=v}catch(_){}if(m!=='bar')document.documentElement.dataset.dockMode=m})()</script>
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
/* Compact lazy tool links. The tray is assembled client-side so consecutive
   calls occupy one visual row without wrapping each button in extra markup. */
.tool-tray { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }
.inplace-popup-panel[id^="chat-panel-"] { width: min(30rem, calc(100vw - 1.5rem)); max-height: min(36rem, calc(100vh - 5rem)); overflow-y: auto; padding: .6rem; }
.chat-icon-ring { position: absolute; inset: -3px; border-radius: 9999px; pointer-events: none; background: conic-gradient(from 0deg, transparent 0 55%, var(--color-primary) 100%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)); mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)); animation: chat-icon-spin 1.1s linear infinite; }
/* The header icon follows the live status region: ring on while it says running. */
.chat-icon-ring--live { display: none; }
.chat-header:has([data-agent-running]) .chat-icon-ring--live { display: block; }
@keyframes chat-icon-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .chat-icon-ring { animation: none; background: var(--color-primary); opacity: .45; } }
.chat-run-ring--live .chat-run-dots { transform-origin: 14px 14px; animation: chat-icon-spin 8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .chat-run-ring--live .chat-run-dots { animation: none; } }
.inplace-popup-panel[id^="chat-panel-"] .chat-row { justify-content: flex-start; min-height: 1.85rem; }
.tool-tray-toggle { display: inline-flex; align-items: center; gap: .3rem; height: 1.5rem; padding: 0 .55rem; border: 1px solid var(--ui-border); border-radius: 9999px; background: rgb(from var(--color-base-100) r g b / .6); font-size: var(--text-2xs); color: var(--color-subtle); cursor: pointer; }
.tool-tray-toggle:hover { color: var(--color-base-content); border-color: var(--ui-border-strong); }
/* Folded: failures and the latest call stay on the row. The latest one is
   marked by the script rather than matched with :last-child, because the live
   region for the running call also sits in this row and would otherwise take
   that position — silently hiding the very call the folded row exists to show. */
.tool-tray--folded > .tool:not(.text-error):not(.tool-latest) { display: none; }
.tool.tool-tucked {
  width: 1.333rem; height: 1.333rem; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 9999px;
  background-color: rgb(from var(--color-base-200) r g b / .62);
  background-image: none;
  background-position: initial;
  background-size: initial;
  border: 1px solid color-mix(in oklab, var(--color-base-content) 14%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 65%, transparent), inset 0 -1px 2px color-mix(in oklab, var(--color-base-content) 10%, transparent), 0 1px 3px color-mix(in oklab, var(--color-base-content) 10%, transparent);
  backdrop-filter: blur(5px) saturate(135%);
  -webkit-backdrop-filter: blur(5px) saturate(135%);
}
.tool.tool-tucked > i { font-size: .7rem; filter: drop-shadow(0 1px 0 color-mix(in oklab, white 80%, transparent)); }
.tool { transition: background-color .2s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.tool.tool-tucked:hover {
  background-color: rgb(from var(--color-base-200) r g b / .76);
  background-image: none;
  border-color: color-mix(in oklab, var(--color-base-content) 20%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 75%, transparent), inset 0 -2px 3px color-mix(in oklab, var(--color-base-content) 12%, transparent), 0 4px 10px color-mix(in oklab, var(--color-base-content) 16%, transparent);
  transform: translateY(-2px) scale(1.15);
  color: var(--color-base-content);
}
.tool.tool-tucked:active { transform: translateY(0) scale(1.05); }
#dock,
.glass-panel {
  background-color: rgb(from var(--color-base-100) r g b / .68);
  background-image: linear-gradient(110deg, rgb(255 255 255 / .16), transparent 48%, rgb(255 255 255 / .05));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22), 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .08);
  backdrop-filter: blur(12px) saturate(115%);
  -webkit-backdrop-filter: blur(12px) saturate(115%);
}
/* The top zone scrolls when pins outgrow it; a soft fade at the bottom edge says there is more. */
#dock-top { scrollbar-width: none; mask-image: linear-gradient(to bottom, black calc(100% - 1.25rem), transparent); padding-bottom: 1rem; }
#dock-top::-webkit-scrollbar { display: none; }
/* Dock modes (html[data-dock-mode], per device in localStorage 'hyper-dock-mode', ⌘B cycles, /dock/dock.js):
   bar — the icon strip (default); menu — the same strip widened with labels; dot — only the menu circle stays,
   at the very same place, and the page takes the whole width. */
#dock { transition: width .16s ease; }
/* Menu: the thin Dock stays; a ChatGPT-like panel with projects and recent chats opens beside it
   (#dock-panel, drawn by dock.panel, loaded on first open and kept live on the agents topic). */
/* One type scale for the whole shell: the same family and smoothing everywhere (the composer's textarea used
   Tailwind's font-sans stack), UI chrome — menu rows, tabs, chat header — at 13px regular, reading text at 14px. */
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
#input, .chat-composer textarea, .chat-composer button { font-family: inherit; }
#dock-panel .nav-row { font-size: 13px; font-weight: 400; min-height: 1.875rem; }
#dock-panel .nav-row > span, #dock-panel .nav-row .text-xs { font-size: 13px; font-weight: 400; color: color-mix(in oklab, var(--color-base-content) 85%, transparent); }
#dock-panel .nav-row:hover > span { color: var(--color-base-content); }
#dock-panel h4, #dock-panel section > h3 { font-size: 11px; font-weight: 500; letter-spacing: .02em; text-transform: none; color: color-mix(in oklab, var(--color-base-content) 45%, transparent); }
.canvas-tab, #chat-panel > header.chat-header [data-chat-part="name"] { font-size: 13px; }
#chat-panel > header.chat-header [data-chat-part="name"] { font-weight: 500 !important; }
/* Message context menu (right-click on a message, ui/hotkeys.js puts it at the pointer). */
#messages .message-menu { display: none; }
#messages [data-message-menu-open] .message-menu { position: fixed; z-index: 70; left: var(--menu-x, 0); top: var(--menu-y, 0); display: flex; flex-direction: column; min-width: 11rem; padding: .25rem; border: 1px solid var(--color-ui-border); border-radius: .5rem; background: var(--color-base-100); box-shadow: 0 8px 24px rgb(0 0 0 / .14); color: var(--color-base-content); font-size: 13px; white-space: nowrap; }
#messages .message-menu-item { display: flex; width: 100%; align-items: center; gap: .5rem; height: 1.875rem; padding: 0 .5rem; border-radius: .3rem; text-align: left; color: inherit; background: none; border: 0; }
#messages .message-menu-item > i { font-size: 15px; color: color-mix(in oklab, var(--color-base-content) 55%, transparent); }
#messages .message-menu-item:hover, #messages .message-menu-item:focus-visible { background: color-mix(in oklab, var(--color-base-content) 7%, transparent); outline: none; }
#messages .message-menu-item--danger:hover, #messages .message-menu-item--danger:hover > i { color: var(--color-error); background: color-mix(in oklab, var(--color-error) 9%, transparent); }
#messages .message-menu-sep { height: 1px; margin: .25rem .25rem; background: var(--color-ui-border); }
.dock-panel { display: none; }
.inplace-popup-panel[data-dock-settings-panel] { width: 15rem; }
/* No side panel on a phone or in the browser-sidebar presentation: there is no room for it. */
@media (max-width: 700px) { html[data-dock-mode] .dock-panel { display: none !important; } }
body[data-presentation="sidebar"] .dock-panel { display: none !important; }
html[data-dock-mode="menu"] #dock [data-dock-panel-toggle] { background: color-mix(in oklab, var(--color-base-content) 9%, transparent); color: var(--color-base-content); }
html[data-dock-mode="menu"] .dock-panel { display: flex; flex-direction: column; width: 16.5rem; flex: none; min-height: 0; height: calc(100% - 1rem); margin: .5rem .25rem .5rem 0; border: 1px solid var(--color-ui-border); border-left: 0; border-radius: 0 1rem 1rem 0; overflow: hidden; background: rgb(from var(--color-base-100) r g b / .68); box-shadow: 0 1px 2px rgb(0 0 0 / .04); }
/* Bar and panel are one card: the bar gives up its right corners and gap, its right border is the divider. */
html[data-dock-mode="menu"] #dock { margin-right: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; box-shadow: 0 1px 2px rgb(0 0 0 / .04); }
/* The grey header cell of the bar (in bar and menu mode alike, so opening the panel moves nothing); with the panel it runs across both: the menu circle sits in the bar's part of it, under it the same hairline. */
html:not([data-dock-mode="dot"]) #dock { padding-top: 0; overflow: hidden; }
html:not([data-dock-mode="dot"]) #dock > [data-dock-id="menu"] { display: grid; place-items: center; height: 2rem; flex: none; border-bottom: 1px solid var(--color-ui-border); background: color-mix(in oklab, var(--color-base-300) 60%, transparent); margin-bottom: .375rem; }
html:not([data-dock-mode="dot"]) #dock > [data-dock-id="menu"] > button { width: 1.5rem; height: 1.5rem; margin: 0; transform: translateY(3px); }
.dock-panel-row[aria-current="page"] { background: color-mix(in oklab, var(--color-base-content) 7%, transparent); color: var(--color-base-content); }
.dock-panel-project[open] > summary { color: var(--color-base-content); }
/* Dot: the strip goes away and the menu circle moves into the top row of the page — the canvas tab row
   (h-8, inside a panel with my-2 ml-2) or the chat header — which makes room for it on the left. */
html[data-dock-mode="dot"] #dock { position: absolute; z-index: 46; top: .625rem; left: .75rem; width: auto; height: auto; margin: 0; padding: 0; border: 0; border-radius: 9999px; background: none; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
/* The circle's slot mirrors the right end of the tab row (history, reload, close): a cell with a bottom border
   and a hairline towards the tabs; the circle itself looks like those buttons. */
html[data-dock-mode="dot"] [data-page="agent"][data-canvas-open] > .canvas-panel > header::before { content: ""; flex: none; width: 2.5rem; border-right: 1px solid var(--color-ui-border); border-bottom: 1px solid var(--color-ui-border); }
html[data-dock-mode="dot"] [data-page="agent"]:not([data-canvas-open]) #chat-panel > header { padding-left: 2.75rem !important; }
html[data-dock-mode="dot"] #main:not(:has(> [data-page="agent"])) { padding-left: 2.75rem; }
html[data-dock-mode="dot"] #dock:not(:hover, :focus-within, :has(:popover-open)) > :not([data-dock-id="menu"]) { display: none !important; }
/* Hovered (or holding focus / an open popover) the circle unfolds into the whole bar over the page, the circle
   staying where it was; the pin button in it keeps the bar for good. */
html[data-dock-mode="dot"] #dock:is(:hover, :focus-within, :has(:popover-open)) { top: calc(.625rem - .5rem - 1px); left: calc(.75rem - .375rem - 1px); bottom: .5rem; height: auto; padding: .5rem .375rem; border: 1px solid var(--color-ui-border); border-radius: 1rem; background-color: rgb(from var(--color-base-100) r g b / .92); box-shadow: 0 8px 28px rgb(0 0 0 / .14); backdrop-filter: blur(12px) saturate(115%); -webkit-backdrop-filter: blur(12px) saturate(115%); }
#dock .dock-pin-on { display: none; }
html[data-dock-mode="dot"] #dock .dock-pin-on { display: inline; }
html[data-dock-mode="dot"] #dock .dock-pin-off { display: none; }
html[data-dock-mode="dot"] #dock [data-dock-id="menu"] button { width: 1.75rem; height: 1.75rem; border-radius: 9999px; }
html[data-dock-mode="dot"] #dock [data-dock-id="menu"] button:hover { background: var(--color-base-200); }
html[data-dock-mode="dot"] body:not(:has([data-canvas-open])) #dock [data-dock-id="menu"] button { border: 1px solid var(--color-ui-border); background: var(--color-base-100); width: 1.75rem; height: 1.75rem; }
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
/* The chat column is a card like the Dock panel and the canvas: rounded border, and on top the same grey 32px
   header row with a hairline under it (instead of the floating pill). Wide screens only; the folded strip and
   the browser-sidebar presentation keep their own looks. */
@media (min-width: 701px) {
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel { margin: .5rem .5rem .5rem 0; border: 1px solid var(--color-ui-border); border-radius: 1rem; overflow: hidden; background: var(--color-base-100); }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-canvas-open]) > #chat-panel { margin-left: .25rem; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel > header.chat-header { position: relative; inset: auto; margin: 0 !important; width: 100% !important; max-width: none; height: 2rem; border: 0; border-bottom: 1px solid var(--color-ui-border); border-radius: 0; padding-left: .5rem; padding-right: .375rem; background: color-mix(in oklab, var(--color-base-300) 60%, transparent) !important; background-image: none !important; box-shadow: none !important; backdrop-filter: none; -webkit-backdrop-filter: none; font-family: inherit; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel > header.chat-header [data-chat-part="name"] { font-family: inherit; font-size: 13px; font-weight: 500; color: var(--color-base-content); }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel > header.chat-header .chat-icon { transform: scale(.85); }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel > header.chat-header button,
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel > header.chat-header a { max-height: 1.5rem; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) .chat-dot-grid { padding-top: 1rem !important; padding-bottom: 1rem !important; background-image: none; background-color: var(--color-base-100); }
  /* The composer is the card's footer, a mirror of its header: full width, a hairline above, the text field and
     its toolbar flat inside it; focus shows as a thin accent line on top instead of a floating ring. */
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel .chat-composer { margin: 0; width: 100%; max-width: none; padding: 0; border-top: 1px solid var(--color-ui-border); background: var(--color-base-100); pointer-events: auto; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel .chat-composer [data-attachments] { margin: .5rem .5rem 0; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel .chat-box.glass-input { border-radius: 0; padding: .25rem .375rem .375rem; background: transparent !important; box-shadow: none !important; backdrop-filter: none; -webkit-backdrop-filter: none; }
  /* Answers sit right on the page, ChatGPT-style: no bubble, border or shadow; the person's message stays a soft pill on the right. */
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .assistant.chat-glass { background: none; border: 0; box-shadow: none; padding: .25rem .25rem; border-radius: 0; }
  /* The person's message is the one inverted shape: the page's text colour as its fill (dark in light theme, light in dark). */
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .chat-glass-primary { background-color: var(--color-base-content); color: var(--color-base-100); border: 0; box-shadow: none; border-radius: .75rem; padding: .5rem .85rem; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .chat-glass-primary [class*="text-white"] { color: color-mix(in oklab, var(--color-base-100) 60%, transparent); }
  /* Tool calls (Replit-style): a run of calls is one rounded pill of icon cells split by hairlines; the folded
     "N tool calls" toggle and the running call sit in the same pill. */
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool-tray { display: inline-flex; width: auto; max-width: 100%; gap: 0; flex-wrap: wrap; border: 1px solid var(--color-ui-border); border-radius: .45rem; overflow: hidden; background: var(--color-base-100); }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool-tray > .tool + .tool, #messages .tool-tray > .tool-tray-toggle + .tool { border-left: 1px solid var(--color-ui-border) !important; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool-tray > #active-tool-call:empty { display: none; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool-tray .tool-tray-toggle { height: 1.375rem; font-size: 11px; border: 0; border-radius: 0; background: transparent; padding: 0 .6rem; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool { width: 1.5rem !important; height: 1.375rem !important; min-width: 0 !important; min-height: 0 !important; padding: 0 !important; border-radius: 0 !important; background: transparent !important; background-image: none !important; box-shadow: none !important; border-top: 0 !important; border-right: 0 !important; border-bottom: 0 !important; backdrop-filter: none !important; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool-tray > :first-child { border-left: 0 !important; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool > i { font-size: .7rem; filter: none; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool.text-error { color: var(--color-error); }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .tool:hover { background: color-mix(in oklab, var(--color-base-content) 6%, var(--color-base-100)) !important; transform: none !important; box-shadow: none !important; }
  /* Author line: a quiet small name, not a coloured headline; the avatar beside the bubble is smaller. */
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages .chat-glass-primary [data-author] { color: color-mix(in oklab, var(--color-base-100) 65%, transparent) !important; font-weight: 500; font-size: 11px; }
  body:not([data-presentation="sidebar"]) [data-page="agent"] #messages [id^="m-"] > img.size-8, body:not([data-presentation="sidebar"]) [data-page="agent"] #messages [id^="m-"] > span.size-8 { width: 1.5rem; height: 1.5rem; font-size: 10px; }
  /* Comfortable reading width in a wide column, centred like ChatGPT. */
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) #messages > * { max-width: 46rem; }
  body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel .chat-composer:focus-within { border-top-color: rgb(59 130 246 / .55); box-shadow: inset 0 1px 0 rgb(59 130 246 / .55); }
}
/* Canvas (src/canvas): hidden until the agent page carries data-canvas-open. Then the canvas takes the
 * free space on the left and the chat becomes a --chat-w column on the right. */
[data-page="agent"] > .canvas-panel, [data-page="agent"] > .canvas-resizer { display: none; }
/* Closed canvas that has tabs: a thin handle at the page's left edge — "Canvas · 4" written upwards; a click
   opens it. The panel shows only its handle then (the rest of it stays hidden). */
.canvas-handle { display: none; }
[data-page="agent"]:not([data-canvas-open]) > .canvas-panel:has(> .canvas-handle) { display: flex; flex: 0 0 auto; width: auto; margin: 0 !important; border: 0 !important; border-radius: 0 !important; background: none !important; box-shadow: none !important; }
[data-page="agent"]:not([data-canvas-open]) > .canvas-panel > :not(.canvas-handle) { display: none !important; }
[data-page="agent"]:not([data-canvas-open]) > .canvas-panel > .canvas-handle { display: flex; flex-direction: column; align-items: center; gap: .5rem; width: 1.75rem; height: 100%; padding: .5rem 0; border-right: 1px solid var(--color-ui-border); background: var(--color-base-200); color: color-mix(in oklab, var(--color-base-content) 55%, transparent); font-size: 12px; cursor: pointer; }
[data-page="agent"]:not([data-canvas-open]) > .canvas-panel > .canvas-handle:hover { background: color-mix(in oklab, var(--color-primary) 8%, var(--color-base-200)); color: var(--color-base-content); }
.canvas-handle-label { writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: .02em; }
.canvas-handle-count { min-width: 1.1rem; height: 1.1rem; padding: 0 .25rem; border-radius: 9999px; background: color-mix(in oklab, var(--color-base-content) 10%, transparent); font-size: 10px; line-height: 1.1rem; text-align: center; font-variant-numeric: tabular-nums; }
@media (max-width: 700px) { [data-page="agent"]:not([data-canvas-open]) > .canvas-panel:has(> .canvas-handle) { display: none !important; } }
[data-page="agent"][data-canvas-open] > .canvas-panel { display: flex; }
[data-page="agent"][data-canvas-open] > .canvas-resizer { display: block; flex: 0 0 8px; cursor: col-resize; position: relative; touch-action: none; }
[data-page="agent"][data-canvas-open] > .canvas-resizer::after { content: ""; position: absolute; inset: 30% 3px; border-radius: 2px; background: var(--color-base-300); transition: background .15s; }
[data-page="agent"][data-canvas-open] > .canvas-resizer:hover::after, [data-page="agent"][data-canvas-open] > .canvas-resizer:focus-visible::after, [data-page="agent"].canvas-resizing > .canvas-resizer::after { background: var(--color-primary); }
[data-page="agent"][data-canvas-open] > #chat-panel { flex: 0 0 var(--chat-w, 440px); width: var(--chat-w, 440px); max-width: calc(100% - 400px); }
[data-page="agent"][data-canvas-open] { position: relative; }
/* Collapsed chat (canvas_state.chat_collapsed, ⌘\ — canvas.toggleChat): the canvas takes the whole page and the
   chat floats over its bottom as a strip — the composer and, above it, the latest message. Hovering or focusing
   the strip shows a little more of the conversation; the header button / ⌘\ brings the column back. */
[data-page="agent"][data-canvas-open] .canvas-chat-toggle { display: inline-flex; }
.canvas-chat-toggle .canvas-chat-unfold, [data-page="agent"][data-chat-collapsed] .canvas-chat-toggle .canvas-chat-fold { display: none; }
[data-page="agent"][data-chat-collapsed] .canvas-chat-toggle .canvas-chat-unfold { display: inline; }
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
[data-page="agent"][data-chat-collapsed] > #chat-panel > header > :not([data-chat-buttons]) { display: none !important; }
[data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-chat-buttons] > :not([data-chat-id="canvas.collapse"]) { display: none !important; }
[data-page="agent"][data-chat-collapsed] #messages > * { max-width: none; }
/* Folded strip as a slide: only the latest answer of the agent, no tool calls, no other messages, no scrolling —
   a new answer replaces the old one. Long answers are cut with a fade; hovering the strip lets it grow. */
[data-page="agent"][data-chat-collapsed] #messages { overflow: hidden !important; display: flex; flex-direction: column; justify-content: flex-end; }
[data-page="agent"][data-chat-collapsed] #messages > * { display: none !important; }
[data-page="agent"][data-chat-collapsed] #messages > [id^="m-"]:has(> .assistant):not(:has(~ [id^="m-"] > .assistant)) { display: flex !important; flex: none; }
[data-page="agent"][data-chat-collapsed] #messages > [id^="m-"] > .assistant { padding: 0 !important; max-height: 5.5rem; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent); mask-image: linear-gradient(to bottom, #000 60%, transparent); }
[data-page="agent"][data-chat-collapsed] > #chat-panel:is(:hover, :focus-within) #messages > [id^="m-"] > .assistant { max-height: min(18rem, 45vh); overflow-y: auto; -webkit-mask-image: none; mask-image: none; }
[data-page="agent"][data-chat-collapsed] #messages .message-menu, [data-page="agent"][data-chat-collapsed] #messages [id^="m-"] .tool-tray { display: none !important; }
/* Moved by dragging its top edge (ui/hotkeys.js); --strip-x/--strip-y are kept per device. */
[data-page="agent"][data-canvas-open][data-chat-collapsed] > #chat-panel[data-strip-moved] { left: var(--strip-x) !important; top: var(--strip-y) !important; bottom: auto !important; transform: none !important; }
[data-page="agent"][data-chat-collapsed] > #chat-panel::before { content: ""; position: absolute; z-index: 3; top: 0; left: 50%; width: 2.5rem; height: 4px; margin: 4px 0 0 -1.25rem; border-radius: 9999px; background: var(--color-ui-border); cursor: grab; }
/* Folded strip input: just the text and send/stop on one line — no attach, model, effort or meters. */
/* One line: [+] text [send/stop]. The toolbar row's box is dissolved (display: contents) so its + goes before
   the text and send after it; model, effort and meters are hidden. */
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box { display: flex; align-items: center; gap: .125rem; padding: .25rem .375rem !important; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box > textarea { order: 1; flex: 1 1 auto; min-width: 0; min-height: 2rem !important; padding: .35rem .25rem !important; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box > div:last-child { display: contents; }
[data-page="agent"][data-chat-collapsed] .chat-composer [data-attach-button] { order: 0; width: 1.75rem !important; height: 1.75rem !important; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box > div:last-child > div:last-child { order: 2; }
[data-page="agent"][data-chat-collapsed] .chat-composer :is([data-chat-tools], [data-chat-meters], [data-chat-above]) { display: none !important; }
/* The folded strip is one tight card: the messages above, then the composer flush with its edges (no box in a
   box) behind a hairline; the toolbar row is compact. */
[data-page="agent"][data-chat-collapsed] #messages { background: none !important; padding: .5rem 3rem .25rem .875rem !important; flex: 1 1 auto; min-height: 0; }
[data-page="agent"][data-chat-collapsed] .chat-composer { margin: 0 !important; width: 100% !important; max-width: none !important; padding: 0 !important; border-top: 1px solid var(--color-ui-border); background: transparent; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box.glass-input { border-radius: 0 !important; padding: 0 .375rem .25rem !important; background: transparent !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
[data-page="agent"][data-chat-collapsed] .chat-composer textarea { min-height: 2rem !important; padding: .4rem .5rem .1rem !important; }
[data-page="agent"][data-chat-collapsed] .chat-composer button { min-width: 0; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box > div:last-child { min-height: 1.75rem; gap: .125rem; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box > div:last-child :is(button, [popovertarget]) { height: 1.75rem !important; min-height: 0 !important; }
[data-page="agent"][data-chat-collapsed] > #chat-panel > header [data-canvas-chat-toggle] { width: 1.5rem; height: 1.5rem; background: none; }
[data-page="agent"][data-chat-collapsed] .chat-composer .chat-box > div:last-child button[type="submit"], [data-page="agent"][data-chat-collapsed] #chat-stop-control button { width: 1.75rem !important; height: 1.75rem !important; }
[data-page="agent"][data-chat-collapsed] .chat-composer:focus-within { border-top-color: rgb(59 130 246 / .55); }
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

.chat-dot-grid { padding-top: 4rem !important; padding-bottom: 6.5rem !important; }
.chat-dot-grid > * {
  width: 100%;
  max-width: 48rem;
  margin-left: auto !important;
  margin-right: auto !important;
}
.chat-composer {
  position: relative;
  z-index: 20;
  flex: none;
  margin: -4.5rem auto .5rem;
  background: transparent;
  pointer-events: none;
}
.chat-composer > * { pointer-events: auto; }
.glass-input {
  min-height: 44px;
  max-height: 208px;
  background-color: rgb(from var(--color-base-100) r g b / .80) !important;
  box-shadow: 0 0 0 1px rgb(0 0 0 / .04), 0 2px 8px rgb(0 0 0 / .04), 0 4px 80px 8px rgb(0 0 0 / .024);
  backdrop-filter: blur(16px) saturate(115%);
  -webkit-backdrop-filter: blur(16px) saturate(115%);
}
.chat-box.glass-input { max-height: none; min-height: 0; }
.chat-box:focus-within { box-shadow: 0 0 0 2px rgb(59 130 246 / .55), 0 2px 10px rgb(0 0 0 / .055), 0 4px 80px 8px rgb(0 0 0 / .03); }
.chat-ring { display: block; width: 18px; height: 18px; border-radius: 9999px; background: conic-gradient(var(--c) var(--p), color-mix(in oklab, var(--color-base-content) 14%, transparent) 0); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px)); mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px)); }
.glass-input:hover { box-shadow: 0 0 0 1px rgb(0 0 0 / .05), 0 2px 9px rgb(0 0 0 / .05), 0 4px 80px 8px rgb(0 0 0 / .028); }
.glass-input:focus {
  box-shadow: 0 0 0 3px rgb(59 130 246 / .72), 0 2px 10px rgb(0 0 0 / .055), 0 4px 80px 8px rgb(0 0 0 / .03);
}
.chat-composer kbd { font: inherit; color: color-mix(in oklab, var(--color-base-content) 55%, transparent); }


.chat-glass,
.chat-glass-primary {
  background-size: 16px 16px;
  background-position: 9px 9px;
  background-attachment: local;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.chat-glass {
  background-color: rgb(from var(--color-base-100) r g b / .86);
}
.chat-glass-primary {
  background-color: rgb(20 20 22 / .94);
}

/* Highlighted code inside tool detail dialogs. */
.app-popup-body pre { margin: 0; padding: .75rem 1rem; border-radius: .65rem; background: rgba(0,0,0,.04) !important; white-space: pre-wrap; word-break: break-word; }
.app-popup-body pre + pre { margin-top: .75rem; }
.app-popup-body code { font-size: 12px; line-height: 1.5; }
.app-popup-body .edit-preview pre { border-radius: 0; background: transparent !important; }
.app-popup-body .edit-remove pre { background: transparent !important; }
.app-popup-body .edit-add pre { background: transparent !important; }

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
  #nav-overlay { padding: max(.5rem, env(safe-area-inset-top)) .5rem max(.5rem, env(safe-area-inset-bottom)) !important; }
  #nav-overlay [role="dialog"] { border-radius: 1.25rem; }
  #nav-overlay .nav-row { min-height: 3rem; }
  [data-page="agent"] { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
  #chat-panel { width: 100%; min-width: 0; }
  #chat-panel > header { width: calc(100% - 1rem) !important; max-width: none !important; margin-top: .4rem !important; padding-right: .55rem !important; gap: .4rem !important; }
  button, a, select, input[type="checkbox"], input[type="radio"] { touch-action: manipulation; }
  #chat-panel > header button:not(.hidden), #chat-panel > header a:not(.hidden) { min-width: 2.25rem; min-height: 2.25rem; display: inline-flex; align-items: center; justify-content: center; }
  #chat-panel > header select { min-height: 2.25rem; }
  .chat-composer button { min-width: 2.75rem; min-height: 2.75rem; }

  #chat-panel > header [data-chat-buttons], #chat-panel > header [data-chat-badges] > :not([data-chat-id="agent.status"]) { display: none !important; }
  #messages, #messages > *, #messages .assistant, #messages .user, #messages .tool { min-width: 0; max-width: 100%; }
  #messages { overflow-x: hidden !important; }
  #messages .tool { min-width: 2.25rem; min-height: 2.25rem; padding: .45rem; touch-action: manipulation; }
  #messages button[data-action="delete-one"], #messages button[data-action="delete-from"] { min-width: 2.25rem; min-height: 2.25rem; }
  #messages [data-load-older] { min-height: 2.75rem; padding-inline: 1rem; }

  #messages .sr-only { width: 1px !important; max-width: 1px !important; overflow: hidden !important; white-space: nowrap !important; }

  #messages .group > .relative > .absolute { display: none !important; }

  #messages [class*="max-w-"] { min-width: 0; }
  #messages .prose, #messages p, #messages li, #messages td, #messages th { overflow-wrap: anywhere; word-break: break-word; }
  #messages pre, #messages .shiki { max-width: 100%; overflow-x: auto !important; overflow-wrap: normal; word-break: normal; }
  #messages img, #messages video, #messages svg, #messages table { max-width: 100%; }
  #messages table { display: block; overflow-x: auto; }
  .chat-composer > * { max-width: 100%; min-width: 0; }

  .chat-dot-grid { padding: 3.75rem .5rem 6.25rem !important; }
  .chat-dot-grid > * { max-width: 100% !important; }
  .chat-composer { width: calc(100% - .75rem) !important; max-width: none !important; margin-bottom: max(.25rem, env(safe-area-inset-bottom)) !important; padding-top: .5rem !important; }
  .chat-composer .glass-input { font-size: 16px !important; }
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
  html[data-chrome="flat"] #dock,
  html[data-chrome="flat"] .dock-panel,
  html[data-chrome="flat"] [data-page="agent"] > .canvas-panel,
  html[data-chrome="flat"] body:not([data-presentation="sidebar"]) [data-page="agent"]:not([data-chat-collapsed]) > #chat-panel {
    margin: 0 !important; height: 100% !important; border-radius: 0 !important; box-shadow: none !important;
    border: 0 !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
  }
  html[data-chrome="flat"]:not([data-dock-mode="dot"]) #dock { border-right: 1px solid var(--color-ui-border) !important; background: var(--color-base-200) !important; background-image: none !important; }
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
  html[data-chrome="flat"] :is(#dock-panel > div > div:first-child, .canvas-panel > header, #chat-panel > header.chat-header) { height: 2rem !important; min-height: 2rem; background: var(--color-base-200) !important; font-size: 13px !important; color: color-mix(in oklab, var(--color-base-content) 70%, transparent); }
  html[data-chrome="flat"] #dock > [data-dock-id="menu"] { background: var(--color-base-200) !important; }
  html[data-chrome="flat"] #dock-panel > div > div:first-child > span { font-size: 13px; font-weight: 500; color: var(--color-base-content); letter-spacing: 0; }
  html[data-chrome="flat"] #chat-panel > header.chat-header [data-chat-part="name"] { font-weight: 500 !important; color: var(--color-base-content) !important; }
  html[data-chrome="flat"] #chat-panel > header.chat-header [data-chat-part="name"] > span { font-size: 12px; font-weight: 400; color: color-mix(in oklab, var(--color-base-content) 45%, transparent); }
  html[data-chrome="flat"] .canvas-tab { font-size: 13px; color: color-mix(in oklab, var(--color-base-content) 60%, transparent); }
  html[data-chrome="flat"] .canvas-tab[aria-current] { color: var(--color-base-content); font-weight: 500; }
  html[data-chrome="flat"] .canvas-tab i { font-size: 14px; }
  html[data-chrome="flat"] :is(#dock-panel > div > div:first-child, .canvas-panel > header, #chat-panel > header.chat-header, #dock > [data-dock-id="menu"]) :is(button, a, summary):not(.canvas-tab *):not([data-chat-part="name"]) { width: 1.75rem; height: 1.75rem; min-width: 1.75rem; border-radius: .375rem; color: color-mix(in oklab, var(--color-base-content) 55%, transparent); }
  html[data-chrome="flat"] :is(#dock-panel > div > div:first-child, .canvas-panel > header, #chat-panel > header.chat-header, #dock > [data-dock-id="menu"]) :is(button, a, summary):not(.canvas-tab *):not([data-chat-part="name"]) > i.ph { font-size: 15px; }
  html[data-chrome="flat"] :is(#dock-panel > div > div:first-child, .canvas-panel > header, #chat-panel > header.chat-header, #dock > [data-dock-id="menu"]) :is(button, a, summary):not(.canvas-tab *):not([data-chat-part="name"]):hover { background: color-mix(in oklab, var(--color-base-content) 7%, transparent); color: var(--color-base-content); }
  html[data-chrome="flat"] #chat-panel > header.chat-header { padding-left: .75rem !important; padding-right: .375rem !important; gap: .5rem !important; }
  html[data-chrome="flat"] #chat-panel > header.chat-header .chat-icon { transform: none; }
  html[data-chrome="flat"] #dock-panel > div > div:first-child { padding-left: .75rem !important; padding-right: .375rem !important; }
  /* The canvas address row: one quiet 32px row in the UI font, not a second header in monospace. */
  html[data-chrome="flat"] [data-canvas-navigate] { height: 2rem !important; border-bottom: 1px solid var(--color-ui-border); background: var(--color-base-100); padding: 0 .375rem !important; gap: .125rem !important; }
  html[data-chrome="flat"] [data-canvas-navigate] input[name="url"] { font-family: inherit !important; font-size: 12px !important; height: 1.5rem; background: transparent !important; color: color-mix(in oklab, var(--color-base-content) 60%, transparent); }
  html[data-chrome="flat"] [data-canvas-navigate] input[name="url"]:focus { background: var(--color-base-200) !important; color: var(--color-base-content); }
  html[data-chrome="flat"] [data-canvas-navigate] :is(button, a) { width: 1.5rem; height: 1.5rem; color: color-mix(in oklab, var(--color-base-content) 50%, transparent); }
  /* The side panel's first row under its header lines up with the address row. */
  html[data-chrome="flat"] #dock-panel > div > div:nth-child(2) > a:first-child { margin-top: .25rem; }
  /* One place says "running": a turning arc around the stop button in the composer. The header's icon ring and
     the dotted run ring stay still (the run ring keeps its time label). */
  html[data-chrome="flat"] #chat-panel > header .chat-icon-ring { display: none !important; }
  html[data-chrome="flat"] #chat-panel > header .chat-run-ring--live .chat-run-dots { animation: none; }
  html[data-chrome="flat"] #chat-stop-control { position: relative; }
  html[data-chrome="flat"] #chat-stop-control:has([aria-label="Stop generation"])::after { content: ""; position: absolute; inset: -3px; border-radius: 9999px; pointer-events: none; background: conic-gradient(from 0deg, transparent 0 60%, var(--color-primary) 100%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px)); mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px)); animation: chat-icon-spin 1.1s linear infinite; }
  @media (prefers-reduced-motion: reduce) { html[data-chrome="flat"] #chat-stop-control::after { animation: none; opacity: .5; } }
  /* No dotted run-time ring in the header: how long the agent has been at it is the clock at the end of the
     tool row (renderActiveToolCall), and "running" is the arc around the stop button. */
  html[data-chrome="flat"] #chat-panel > header .chat-run-ring { display: none !important; }
  /* The running call: the last cell of the pill, its icon dimming in and out; how long it runs is plain grey
     seconds just outside the pill. */
  #messages .tool-tray { position: relative; overflow: visible !important; }
  #messages .tool-tray > #active-tool-call { display: contents; }
  #messages .tool-tray > #active-tool-call > .tool { border-left: 1px solid var(--color-ui-border) !important; }
  #messages .tool-tray > :first-child:is(#active-tool-call) > .tool { border-left: 0 !important; }
  #messages .tool-row-clock { position: absolute; left: calc(100% + .5rem); top: 50%; transform: translateY(-50%); font-size: 11px; font-variant-numeric: tabular-nums; color: color-mix(in oklab, var(--color-base-content) 45%, transparent); white-space: nowrap; pointer-events: none; }
  #messages [data-tool-running] > span.pointer-events-none { display: none !important; }
  @keyframes tool-glow { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  #messages [data-tool-running] > i { animation: tool-glow 1.6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { #messages [data-tool-running] > i { animation: none; } }
  /* Headers: one small type everywhere — 12px, medium for names, regular for tabs. */
  html[data-chrome="flat"] :is(#dock-panel > div > div:first-child, .canvas-panel > header, #chat-panel > header.chat-header) { font-size: 12px !important; }
  html[data-chrome="flat"] #dock-panel > div > div:first-child > span,
  html[data-chrome="flat"] .canvas-tab,
  html[data-chrome="flat"] .canvas-tab span,
  html[data-chrome="flat"] #chat-panel > header.chat-header [data-chat-part="name"] { font-size: 12px !important; line-height: 1rem; }
  html[data-chrome="flat"] #chat-panel > header.chat-header [data-chat-part="name"] > span { font-size: 12px !important; }
  html[data-chrome="flat"] :is(#dock-panel > div > div:first-child, .canvas-panel > header, #chat-panel > header.chat-header) :is(button, a, summary):not(.canvas-tab *):not([data-chat-part="name"]) > i.ph { font-size: 14px !important; }
  html[data-chrome="flat"] .canvas-tab i { font-size: 13px !important; }
  /* The menu circle in the bar's header cell: the same 28px button as every header button, centred in the cell. */
  html[data-chrome="flat"]:not([data-dock-mode="dot"]) #dock > [data-dock-id="menu"] > button { transform: none !important; width: 1.75rem !important; height: 1.75rem !important; }
  html[data-chrome="flat"]:not([data-dock-mode="dot"]) #dock > [data-dock-id="menu"] > button > i { font-size: 15px !important; line-height: 1; }
  /* Fewer things in the composer: the context ring and the quiet prompt-inject icon live in the ⋯ panel (Context
     card: compact, prompt inject; the inspector row opens the inspector tab). A non-default prompt inject still
     shows as its chip above the text. */
  html[data-chrome="flat"] #chat-context-ring { display: none !important; }
  html[data-chrome="flat"] .chat-composer [data-chat-meters] [popovertarget^="status-line-popover-"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  html[data-chrome="flat"] #chat-panel > header [data-chat-id="agent.inspector"] { display: none !important; }
  /* In dot mode the circle sits in the first header cell; with the strip gone there is no gap to leave. */
  html[data-chrome="flat"][data-dock-mode="dot"] #dock { top: .125rem; left: .375rem; }
}
</style>

<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .shiki { background: transparent !important; }
  .assistant pre.shiki { padding: .6em .8em; border-radius: 6px; overflow-x: auto; margin: .4em 0; font-size: 12.5px; line-height: 1.45; }
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
<script src="/ui/hotkeys.js?v=4" defer></script>
<script src="/ui/rpc.js?v=6" defer></script>
<script src="/agent/chat.js" defer></script>
<script src="/ui/popup.js" defer></script>
<script src="/chat/header.js" defer></script>
<script src="/ui/meta.js" defer></script>
<script src="/screen/client.js" defer></script>
<script src="/ui/wake-timer.js" defer></script>
<script src="/ui/spin-sync.js" defer></script>
<script src="/ui/tool-timer.js?v=2" defer></script>
</head>
<body class="bg-base-200 text-base-content text-sm h-screen${embedded ? " overflow-hidden" : ""}"${currentId ? ` data-agent-id="${esc(currentId)}"` : ""}${sidebar ? ' data-presentation="sidebar"' : ""}>
<div id="frame" class="relative flex h-screen">
  ${hideNavigation ? "" : ctx.fns.procs.ui.button({ action: "open-global-menu-mobile", html: '<i class="ph ph-squares-four text-xl" aria-hidden="true"></i>', appearance: "plain", title: "Agents and pages", ariaLabel: "Open agents and pages", class: "hidden", attrs: { id: "mobile-nav-button", onclick: "window.__navOpen?.()" } })}
  ${hideNavigation ? "" : await ctx.fns.dock.render({})}
  ${hideNavigation ? "" : ctx.fns.ui.live({ id: "dock-panel", url: "/dock/panel", topic: "agents", every: 120, tag: "aside", swap: "innerHTML", trigger: "load[document.documentElement.dataset.dockMode==='menu'], dock-panel-load", attrs: 'aria-label="Projects and chats" class="dock-panel"' })}
    <script src="/canvas/canvas.js?v=2" defer></script>
  <!-- This container owns no navigation attributes: live descendants must
       always target themselves, while navigation is handled by the global menu. -->
  <section id="page-view" class="flex min-w-0 flex-1 flex-col bg-base-100">
    <main id="main" hx-history-elt class="min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto">${opts.main}</main>
  </section>
</div>
${embedded ? "" : `<dialog id="app-popup" class="m-auto max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ui-border bg-base-100 p-0 text-base-content shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[1px]">
  <div class="flex max-h-[85vh] flex-col">
    <div class="flex shrink-0 items-center gap-3 border-b border-ui-border px-5 py-3.5"><h2 id="app-popup-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-muted">Details</h2>${ctx.fns.procs.ui.button({ action: "close-popup", html: '<i class="ph ph-x text-lg"></i>', appearance: "plain", title: "Close", ariaLabel: "Close", class: "flex size-8 items-center justify-center rounded-full text-faint hover:bg-base-200 hover:text-base-content", attrs: { id: "app-popup-close" } })}</div>
    <div id="app-popup-body" class="app-popup-body min-h-0 flex-1 overflow-auto bg-base-200/60 p-5 text-xs text-muted"></div>
  </div>
</dialog>
${hideNavigation ? "" : ctx.fns.ui.navMenu({})}`}
${ctx.fns.procs.ui.button({ action: "secure-input", appearance: "plain", ariaLabel: "Secure input", class: "hidden", attrs: { id: "secure-input-host", "hx-popup": "secureInput.current", "data-pending": (ctx.state as any).secureInput?.prompts?.size ? '1' : '0' } })}

${embedded ? `<script>document.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();window.parent.postMessage({type:'ui.close-popup'},location.origin)}})</script>` : `<script>window.addEventListener('message',function(event){if(event.origin!==location.origin||event.data?.type!=='ui.close-popup')return;var dialog=document.getElementById('app-popup');if(dialog?.open)dialog.close()})</script>`}

</body>
</html>`;
}
