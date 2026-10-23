// /browser/live — the live view page: a thin toolbar (tabs, back, forward,
// reload, address, insert text, quality, status) over a canvas that shows one
// Chrome tab. The status pill opens a panel with the whole path's health.
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
  :root { color-scheme: light dark; --bar: #f6f6f7; --fg: #1f2328; --muted: #6b7280; --line: #e3e3e6; --field: #ececef; --hover: rgba(0,0,0,.06); --ok: #16a34a; --warn: #d97706; --bad: #dc2626; --stage: #e9e9ec; }
  @media (prefers-color-scheme: dark) { :root { --bar: #1f1f23; --fg: #e8e8ea; --muted: #9ca3af; --line: #33333a; --field: #2a2a30; --hover: rgba(255,255,255,.08); --stage: #141417; } }
  html, body { margin: 0; height: 100%; background: var(--stage); font: 13px -apple-system, system-ui, sans-serif; color: var(--fg); }
  body { display: flex; flex-direction: column; }
  header { display: flex; gap: 4px; align-items: center; padding: 6px 8px; background: var(--bar); border-bottom: 1px solid var(--line); }
  .ib { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--fg); cursor: pointer; flex: none; }
  .ib:hover { background: var(--hover); }
  .ib:active { transform: scale(.94); }
  .ib[aria-pressed="true"] { background: var(--hover); color: #2563eb; }
  select { height: 30px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  select:hover { background: var(--hover); }
  #lv-tabs { display: inline-flex; align-items: center; gap: 4px; max-width: 220px; height: 30px; padding: 0 8px 0 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; flex: none; }
  #lv-tabs:hover, #lv-tabs[aria-expanded="true"] { background: var(--hover); }
  #lv-tabs-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #lv-tabmenu { left: 8px; right: auto; width: 340px; max-height: 70vh; overflow: auto; padding: 6px; }
  #lv-tabmenu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  #lv-tabmenu button:hover { background: var(--hover); }
  #lv-tabmenu button[aria-current="true"] { background: color-mix(in srgb, #2563eb 14%, transparent); }
  #lv-tabmenu .t { flex: 1; min-width: 0; }
  #lv-tabmenu .t b, #lv-tabmenu .t small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #lv-tabmenu .t b { font-weight: 500; }
  #lv-tabmenu .t small { color: var(--muted); font-size: 11px; }
  #lv-tabmenu .new { font-weight: 500; }
  #lv-tabmenu hr { margin: 4px 2px; border: 0; border-top: 1px solid var(--line); }
  #lv-address { flex: 1; min-width: 120px; height: 30px; padding: 0 14px; margin: 0 4px; border-radius: 15px; border: 1px solid transparent; background: var(--field); color: inherit; font: inherit; outline: none; }
  #lv-address:focus { border-color: #2563eb; background: var(--bar); }
  #lv-status { min-width: 72px; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 0; border-radius: 15px; background: transparent; color: var(--muted); font-family: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; max-width: 36ch; overflow: hidden; text-overflow: ellipsis; }
  #lv-status:hover { background: var(--hover); }
  #lv-status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  #lv-status[data-state="ok"]::before { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
  #lv-status[data-state="wait"]::before { background: var(--warn); }
  #lv-status[data-state="bad"] { color: var(--bad); }
  #lv-status[data-state="bad"]::before { background: var(--bad); }
  main { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  #lv-screen { background: #fff; outline: none; cursor: default; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.12); transition: filter .2s; }
  main[data-stale="1"] #lv-screen { filter: grayscale(.6) opacity(.6); }
  #lv-banner { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); max-width: 80%; padding: 8px 14px; border-radius: 10px; background: var(--bad); color: #fff; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.2); z-index: 3; }
  #lv-banner[hidden] { display: none; }
  .pop { position: absolute; top: 46px; right: 8px; padding: 10px; background: var(--bar); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.18); z-index: 4; }
  .pop[hidden] { display: none !important; }
  #lv-paste { display: flex; flex-direction: column; gap: 8px; }
  #lv-paste textarea { width: 320px; height: 90px; padding: 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); color: inherit; font: inherit; resize: vertical; }
  #lv-paste button { align-self: flex-end; height: 30px; padding: 0 14px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font: inherit; cursor: pointer; }
  #lv-info { width: 340px; font-size: 12px; }
  #lv-info h3 { margin: 0 0 8px; font-size: 13px; }
  #lv-info dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  #lv-info dt { color: var(--muted); }
  #lv-info dd { margin: 0; font-family: ui-monospace, monospace; word-break: break-all; }
  #lv-info .bad { color: var(--bad); }
  #lv-info .ok { color: var(--ok); }
</style></head>
<body>
<header>
  <button id="lv-tabs" title="Chrome tabs" aria-haspopup="menu" aria-expanded="false"><span id="lv-tabs-label">Tabs</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
  <button class="ib" id="lv-back" title="Back"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
  <button class="ib" id="lv-forward" title="Forward"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
  <button class="ib" id="lv-reload" title="Reload"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>
  <input id="lv-address" placeholder="Address or search" spellcheck="false" autocomplete="off">
  <button class="ib" id="lv-insert" title="Type text into the focused field" aria-pressed="false"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg></button>
  <select id="lv-quality" title="Picture quality: Auto lowers it when frames lag">
    <option value="auto">Auto</option><option value="high">High</option><option value="low">Low</option>
  </select>
  <button id="lv-status" title="Connection details" aria-pressed="false"></button>
</header>
<div id="lv-paste" class="pop" hidden>
  <textarea id="lv-paste-text" placeholder="Text to type into the page"></textarea>
  <button id="lv-paste-send">Insert</button>
</div>
<div id="lv-tabmenu" class="pop" role="menu" hidden></div>
<div id="lv-info" class="pop" hidden><h3>Live view</h3><dl id="lv-info-list"></dl></div>
<main><div id="lv-banner" hidden></div><canvas id="lv-screen" tabindex="0" width="800" height="600"></canvas></main>
<script src="/browser/live.js"></script>
</body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN" } });
}
