// /browser/live — the live view page: a thin toolbar (tabs, back, forward,
// reload, address, insert text) over a canvas that shows one Chrome tab.
// `?target=<targetId>` picks the tab, `?cdp=<endpoint>` an allowed other Chrome.
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const url = new URL(opts.req.url);
    try {
        await ctx.fns.browser.liveCdp({ requested: url.searchParams.get("cdp") ?? undefined });
    } catch (e: any) {
        return new Response(e.message, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Live view</title>
<style>
  :root { color-scheme: light dark; --bar: #f3f3f4; --fg: #222; --line: #d6d6da; }
  @media (prefers-color-scheme: dark) { :root { --bar: #232327; --fg: #e8e8ea; --line: #3a3a40; } }
  html, body { margin: 0; height: 100%; background: #6b6b70; font: 13px system-ui, sans-serif; color: var(--fg); }
  body { display: flex; flex-direction: column; }
  header { display: flex; gap: 6px; align-items: center; padding: 6px 8px; background: var(--bar); border-bottom: 1px solid var(--line); }
  header button { min-width: 30px; height: 28px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 14px; }
  header button:hover { background: rgba(127,127,127,.15); }
  #lv-tabs { max-width: 260px; height: 28px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; }
  #lv-address { flex: 1; min-width: 120px; height: 26px; padding: 0 10px; border-radius: 14px; border: 1px solid var(--line); background: rgba(127,127,127,.08); color: inherit; }
  #lv-status { font-size: 12px; white-space: nowrap; max-width: 30ch; overflow: hidden; text-overflow: ellipsis; }
  #lv-status[data-state="ok"]::before { content: "● "; color: #d33; }
  #lv-status[data-state="bad"] { color: #d33; }
  main { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  #lv-screen { max-width: 100%; max-height: 100%; background: #fff; outline: none; cursor: default; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
  #lv-paste { position: absolute; top: 44px; right: 8px; padding: 8px; background: var(--bar); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; gap: 6px; z-index: 2; }
  #lv-paste[hidden] { display: none; }
  #lv-paste textarea { width: 320px; height: 90px; }
</style></head>
<body>
<header>
  <select id="lv-tabs" title="Tabs"></select>
  <button id="lv-back" title="Back">←</button>
  <button id="lv-forward" title="Forward">→</button>
  <button id="lv-reload" title="Reload">↻</button>
  <input id="lv-address" placeholder="Address or search" spellcheck="false" autocomplete="off">
  <button id="lv-insert" title="Insert text into the focused field">Insert text</button>
  <span id="lv-status"></span>
</header>
<div id="lv-paste" hidden>
  <textarea id="lv-paste-text" placeholder="Text to type into the page"></textarea>
  <button id="lv-paste-send">Insert</button>
</div>
<main><canvas id="lv-screen" tabindex="0" width="800" height="600"></canvas></main>
<script src="/browser/live.js"></script>
</body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN" } });
}
