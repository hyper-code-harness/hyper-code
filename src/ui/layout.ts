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
    // A tiny terminal prompt: dark enough to survive light browser chrome,
    const sidebar = !embedded && session?.url?.searchParams.get("presentation") === "sidebar";
    const hideNavigation = embedded || sidebar;
    // with a mint chevron and violet cursor that remain legible at 16×16.
    const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#252a34"/><path d="m8 9 7 7-7 7" fill="none" stroke="#6ee7b7" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 23H25" stroke="#a78bfa" stroke-width="3.2" stroke-linecap="round"/><circle cx="25" cy="7" r="2.3" fill="#fb7185"/></svg>`;
    const favicon = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script>(function(){try{var saved=localStorage.getItem('hyper-theme');var theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(_){document.documentElement.dataset.theme='light';document.documentElement.style.colorScheme='light'}})()</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(pageTitle)}</title>
<script src="/ui/vendor/tailwind.js"></script>
<link rel="icon" href="${favicon}" type="image/svg+xml">
<script src="/ui/vendor/htmx.js" defer></script>
<link rel="stylesheet" href="/ui/vendor/phosphor.css">
<style>
/* Compact lazy tool links. The tray is assembled client-side so consecutive
   calls occupy one visual row without wrapping each button in extra markup. */
.tool-tray { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }
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
#quick-bar,
.glass-panel {
  background-color: rgb(from var(--color-base-100) r g b / .68);
  background-image: linear-gradient(110deg, rgb(255 255 255 / .16), transparent 48%, rgb(255 255 255 / .05));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22), 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .08);
  backdrop-filter: blur(12px) saturate(115%);
  -webkit-backdrop-filter: blur(12px) saturate(115%);
}
.glass-panel {
  box-shadow: inherit;
}
.agent-meta-panel { transition: width .18s ease, border-radius .18s ease; }
.agent-meta-panel.agent-meta-collapsed { width: 2.5rem !important; min-width: 2.5rem; }
.agent-meta-panel.agent-meta-collapsed [data-agent-meta-content],
.agent-meta-panel.agent-meta-collapsed [data-agent-meta-label] { display: none; }
.agent-meta-panel.agent-meta-collapsed > header { height: 100%; align-items: flex-start; justify-content: center; border-bottom: 0; padding: .5rem 0; background: transparent !important; }
.agent-meta-panel.agent-meta-collapsed .agent-meta-toggle { color: var(--theme-base-content); }

.glass-bar {
  background-color: rgb(from var(--color-base-100) r g b / .68) !important;
  background-image: linear-gradient(110deg, rgb(255 255 255 / .12), transparent 45%, rgb(255 255 255 / .04));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .22), 0 1px 2px rgb(0 0 0 / .04), 0 8px 24px rgb(0 0 0 / .08);
  backdrop-filter: blur(12px) saturate(115%);
  -webkit-backdrop-filter: blur(12px) saturate(115%);
}
#chat-panel { position: relative; }
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
.chat-composer .glass-input { padding-right: 3.25rem; }
.glass-input:hover { box-shadow: 0 0 0 1px rgb(0 0 0 / .05), 0 2px 9px rgb(0 0 0 / .05), 0 4px 80px 8px rgb(0 0 0 / .028); }
.glass-input:focus {
  box-shadow: 0 0 0 3px rgb(59 130 246 / .72), 0 2px 10px rgb(0 0 0 / .055), 0 4px 80px 8px rgb(0 0 0 / .03);
}
.chat-composer kbd { font: inherit; color: color-mix(in oklab, var(--color-base-content) 55%, transparent); }
.mermaid-diagram { display: block; width: 100%; max-width: 100%; min-width: 0; overflow: hidden; }
.mermaid-light { display: block; width: 100%; max-width: 100%; min-width: 0; }
.mermaid-diagram svg { display: block; width: auto; max-width: 100% !important; height: auto !important; }


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
  background-image: radial-gradient(circle, color-mix(in oklab, var(--color-base-content) 5%, transparent) 0 1px, transparent 1.35px);
}
.chat-glass-primary {
  background-color: rgb(20 20 22 / .94);
  background-image: radial-gradient(circle, rgb(255 255 255 / .23) 0 1.1px, transparent 1.5px);
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
  #quick-bar { display: none !important; }
  #page-view, #main { width: 100%; height: 100dvh; min-height: 0; overflow: hidden; }
  #mobile-nav-button { display: inline-flex !important; position: fixed; z-index: 49; top: max(.4rem, env(safe-area-inset-top)); left: .5rem; width: 2.75rem; height: 2.75rem; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid var(--color-ui-border); background: rgb(from var(--color-base-100) r g b / .82); color: color-mix(in oklab, var(--color-base-content) 72%, transparent); box-shadow: inset 0 1px 0 rgb(255 255 255 / .25), 0 5px 18px rgb(0 0 0 / .14); backdrop-filter: blur(16px) saturate(120%); -webkit-backdrop-filter: blur(16px) saturate(120%); touch-action: manipulation; }
  #mobile-nav-button:active { transform: scale(.94); }
  #chat-panel > header { padding-left: 3.1rem !important; }
  #nav-overlay { padding: max(.5rem, env(safe-area-inset-top)) .5rem max(.5rem, env(safe-area-inset-bottom)) !important; }
  #nav-overlay [role="dialog"] { border-radius: 1.25rem; }
  #nav-overlay .nav-row { min-height: 3rem; }
  [data-page="agent"] { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
  [data-page="agent"] > aside[id^="agent-meta-"] { display: none !important; }
  #chat-panel { width: 100%; min-width: 0; }
  #chat-panel > header { width: calc(100% - 1rem) !important; max-width: none !important; margin-top: .4rem !important; padding-right: .55rem !important; gap: .4rem !important; }
  button, a, select, input[type="checkbox"], input[type="radio"] { touch-action: manipulation; }
  #chat-panel > header button, #chat-panel > header a { min-width: 2.25rem; min-height: 2.25rem; display: inline-flex; align-items: center; justify-content: center; }
  #chat-panel > header select { min-height: 2.25rem; }
  .chat-composer button { min-width: 2.75rem; min-height: 2.75rem; }
  .chat-composer [data-attach-button] { left: 0; top: 0; }

  #chat-panel > header > span:nth-of-type(1) { flex: 1; }
  #chat-panel > header > span.ml-auto { max-width: 3.25rem; overflow: hidden; }
  #chat-panel > header > span.ml-auto > :not(:first-child) { display: none !important; }
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
  .chat-composer > div:first-child { display: none; }
  .chat-composer .glass-input { font-size: 16px !important; }
  #app-popup { width: calc(100vw - 1rem) !important; max-height: calc(100dvh - 1rem) !important; }
  #app-popup > div { max-height: calc(100dvh - 1rem) !important; }
}


/* Sidebar presentation reuses the page and live chat, independent of viewport. */
body[data-presentation="sidebar"] #quick-bar,
body[data-presentation="sidebar"] #mobile-nav-button,
body[data-presentation="sidebar"] #nav-overlay,
body[data-presentation="sidebar"] [data-page="agent"] > aside[id^="agent-meta-"] { display: none !important; }
body[data-presentation="sidebar"] #chat-panel > header { padding-left: .55rem !important; }
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
<script src="/ui/control.js" defer></script>
<script src="/procs/events/client.js" defer></script>
<script src="/ui/hotkeys.js" defer></script>
<script src="/ui/rpc.js?v=5" defer></script>
<script src="/agent/chat.js" defer></script>
<script src="/ui/popup.js" defer></script>
<script src="/ui/meta.js" defer></script>
<script src="/screen/client.js" defer></script>
<script src="/ui/wake-timer.js" defer></script>
</head>
<body hx-ext="popup-rpc" class="bg-base-200 text-base-content text-sm h-screen${embedded ? " overflow-hidden" : ""}"${currentId ? ` data-agent-id="${esc(currentId)}"` : ""}${sidebar ? ' data-presentation="sidebar"' : ""}>
<div id="frame" class="relative flex h-screen">
  ${hideNavigation ? "" : ctx.fns.procs.ui.button({ action: "open-global-menu-mobile", html: '<i class="ph ph-squares-four text-xl" aria-hidden="true"></i>', appearance: "plain", title: "Agents and pages", ariaLabel: "Open agents and pages", class: "hidden", attrs: { id: "mobile-nav-button", onclick: "window.__navOpen?.()" } })}
  ${hideNavigation ? "" : `<nav id="quick-bar" aria-label="Quick access" class="my-2 ml-2 mr-1 flex h-[calc(100%-1rem)] w-10 shrink-0 flex-col items-center rounded-2xl border border-ui-border py-2 shadow-sm">
    ${ctx.fns.procs.ui.button({ action: "open-global-menu", html: '<i class="ph ph-squares-four text-base" aria-hidden="true"></i>', appearance: "plain", title: "Global menu — ⌘/", ariaLabel: "Open global menu", class: "flex size-7 items-center justify-center rounded-md text-base-content/60 hover:bg-base-300 hover:text-base-content", attrs: { onclick: "window.__navOpen?.()" } })}
    ${ctx.fns.procs.ui.button({ action: "toggle-theme", html: '<i class="ph ph-moon" aria-hidden="true"></i>', appearance: "plain", title: "Switch color theme", ariaLabel: "Switch color theme", class: "mt-1 flex size-7 items-center justify-center rounded-md text-base-content/60 hover:bg-base-300 hover:text-base-content", attrs: { id: "theme-toggle", "aria-pressed": "false" } })}
    ${await ctx.fns.ui.gapBadge({})}
    <div id="quick-items" class="mt-2 flex min-h-0 flex-1 flex-col items-center gap-1" aria-label="Pinned pages"></div>
    <!-- Subscription quota, loaded by itself so the shell never waits on it.
         Collapsed to rings in the narrow bar; the title carries the detail. -->
    <div id="quota-rings" class="mt-auto w-full" hx-get="/llms/usage" hx-trigger="load" hx-swap="innerHTML" hx-target="this"></div>
    <script>(function(){var button=document.getElementById('theme-toggle');function paint(){var dark=document.documentElement.dataset.theme==='dark';button.setAttribute('aria-pressed',String(dark));button.title=dark?'Use light theme':'Use dark theme';button.querySelector('i').className='ph '+(dark?'ph-sun':'ph-moon')}paint();button.addEventListener('click',function(){var next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;document.documentElement.style.colorScheme=next;try{localStorage.setItem('hyper-theme',next)}catch(_){}paint()})})()</script>
  </nav>`}
    <script src="/ui/gap-count.js" defer></script>
  <!-- This container owns no navigation attributes: live descendants must
       always target themselves, while navigation is handled by the global menu. -->
  <section id="page-view" class="flex min-w-0 flex-1 flex-col bg-base-100">
    <main id="main" hx-history-elt class="min-h-0 min-w-0 flex flex-1 flex-col overflow-y-auto">${opts.main}</main>
  </section>
</div>
${embedded ? "" : `<dialog id="app-popup" class="m-auto max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ui-border bg-base-100 p-0 text-base-content shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[1px]">
  <div class="flex max-h-[85vh] flex-col">
    <div class="flex shrink-0 items-center gap-3 border-b border-ui-border px-5 py-3.5"><h2 id="app-popup-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-base-content/80">Details</h2>${ctx.fns.procs.ui.button({ action: "close-popup", html: '<i class="ph ph-x text-lg"></i>', appearance: "plain", title: "Close", ariaLabel: "Close", class: "flex size-8 items-center justify-center rounded-full text-base-content/45 hover:bg-base-200 hover:text-base-content", attrs: { id: "app-popup-close" } })}</div>
    <div id="app-popup-body" class="app-popup-body min-h-0 flex-1 overflow-auto bg-base-200/60 p-5 text-xs text-base-content/70"></div>
  </div>
</dialog>
${hideNavigation ? "" : ctx.fns.ui.navMenu({})}`}
${ctx.fns.procs.ui.button({ action: "secure-input", appearance: "plain", ariaLabel: "Secure input", class: "hidden", attrs: { id: "secure-input-host", "hx-popup": "secureInput.current", "data-pending": (ctx.state as any).secureInput?.prompts?.size ? '1' : '0' } })}

${embedded ? `<script>document.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();window.parent.postMessage({type:'ui.close-popup'},location.origin)}})</script>` : `<script>window.addEventListener('message',function(event){if(event.origin!==location.origin||event.data?.type!=='ui.close-popup')return;var dialog=document.getElementById('app-popup');if(dialog?.open)dialog.close()})</script>`}

</body>
</html>`;
}
