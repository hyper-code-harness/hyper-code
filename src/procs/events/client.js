// The browser half of the live-update stream. Read docs/live-updates.md first.
//
// Two jobs:
//   1. Transport — one topic-filtered SSE stream per tab, kept open whenever the
//      connection can afford it (see `keepWhileHidden`).
//   2. Delivery — every event goes to the subscribers registered through
//      `window.hyperLive.subscribe` / `.command`, and after any GAP (the stream was
//      down, the tab was frozen) every state subscriber is told to `resync`:
//      re-read its state from the server. An event is a hint; the server's GET is
//      the truth. A subscriber cannot register without saying how it catches up.
(() => {
  if (window.__hyperEventsInstalled) return;
  window.__hyperEventsInstalled = true;

  let es;
  let reconnectTimer = null;
  let retryMs = 1000;
  let lastTopics = '';
  let greeted = false;
  let planned = false;   // we closed the stream ourselves (the topic set changed)

  // ── Subscribers ─────────────────────────────────────────────────────────
  // State subscribers mirror something the server owns (a badge, the canvas, a
  // panel). They get `onEvent` for each matching event and MUST supply
  // `resync`, called after a gap, because events sent while the stream was down
  // are gone for good. Command subscribers act on one-shot instructions
  // (navigate, toast, run this code); a command missed while away is not
  // replayed — the sender owns its timeout.
  const subscribers = new Set();
  const matches = (sub, data) => !sub.types || sub.types.includes(data?.type);

  function register(kind, opts) {
    const { types, onEvent, resync, name } = opts || {};
    if (types !== undefined && !(Array.isArray(types) && types.every(t => typeof t === 'string'))) throw new TypeError('hyperLive: types must be an array of event type strings');
    if (typeof onEvent !== 'function') throw new TypeError('hyperLive: onEvent(event) is required');
    if (kind === 'state' && typeof resync !== 'function') throw new TypeError(`hyperLive.subscribe(${name || types?.join(',') || ''}): resync() is required — say how this subscriber re-reads its state after a gap, or use hyperLive.command for one-shot instructions`);
    const sub = { kind, name: String(name || types?.join(',') || 'anonymous'), types, onEvent, resync: kind === 'state' ? resync : null };
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  }

  function deliver(data) {
    for (const sub of [...subscribers]) {
      if (!matches(sub, data)) continue;
      try { sub.onEvent(data); } catch (error) { console.error(`hyperLive ${sub.name}:`, error); }
    }
    // Compatibility: older scripts listened on the DOM event directly. New code
    // must not (code.quality rule `live-subscribe`); it misses the resync.
    document.dispatchEvent(new CustomEvent('hyper-events', { detail: data }));
  }

  // After a gap: live regions re-fetch themselves, every state subscriber re-reads.
  // A hidden tab defers this until it is shown — it cannot be seen being stale,
  // and a pile of background tabs must not all re-fetch at once.
  let resyncPending = false;
  function resyncAll(reason) {
    if (document.visibilityState !== 'visible') { resyncPending = true; return; }
    resyncPending = false;
    for (const topic of topics()) refreshSoon(topic);
    for (const sub of [...subscribers]) {
      if (!sub.resync) continue;
      try { sub.resync(reason); } catch (error) { console.error(`hyperLive ${sub.name} resync:`, error); }
    }
  }

  window.hyperLive = {
    /** State subscriber: { types?, onEvent(event), resync(reason), name? } → unsubscribe. */
    subscribe: opts => register('state', opts),
    /** One-shot instructions (no state to re-read): { types?, onEvent(event), name? } → unsubscribe. */
    command: opts => register('command', opts),
    /** Ask every state subscriber to re-read now (tests, debugging). */
    resync: reason => resyncAll(reason || 'manual'),
    /** Whether this tab keeps its stream while hidden (multiplexed HTTP/2 or HTTP/3). */
    keepsStreamWhileHidden: () => keepWhileHidden(),
  };

  // Track the server's start timestamp so a reload broadcast that happens
  // before the page even fully wired up still triggers a refresh, and so
  // we ignore stale `hello` echoes when reconnecting to the same process.
  let serverStart = null;

  // ── Live regions ────────────────────────────────────────────────────────
  // The server says "refresh agent:eh"; every region carrying that topic asks
  // for itself again. That is the whole protocol.
  //
  // There is deliberately NO client state — no cursors, no "what did I already
  // ask for". State on two sides is state that can disagree, and it did: server
  // sequence numbers reset on restart while tabs kept the old ones, so regions
  // looked permanently stale and refetched forever. Nothing is remembered now,
  // so a restart is not an event at all.
  //
  // A refresh cannot cause a refresh: signals come from writes, never from
  // reads, and re-fetching a region publishes nothing. The loop is impossible by
  // construction rather than prevented by a guard.
  const dirty = new Set();
  let flushTimer = null;

  function regions() {
    return document.querySelectorAll('[data-live-topic]');
  }

  function topics() {
    return [...new Set([...regions()].map(el => el.dataset.liveTopic))].filter(Boolean).sort();
  }

  // Coalesce: twenty changes in a moment cost one request, not twenty.
  function refreshSoon(topic) {
    if (topic) dirty.add(topic);
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 100);
  }

  function flush() {
    if (document.visibilityState !== 'visible') return;   // a hidden tab catches up on return
    const wanted = new Set(dirty);
    dirty.clear();
    if (!wanted.size) return;
    for (const el of regions()) {
      // Non-bubbling: only regions of this topic refresh, not every listener on body.
      if (wanted.has(el.dataset.liveTopic)) el.dispatchEvent(new CustomEvent('hyper-live', { bubbles: false }));
    }
  }

  function handle(data) {
    deliver(data);
    // Server restarted under us — reload to pick up the new process.
    if (data?.type === 'hello') {
      sawServer(data.serverStart);
      // Catching up is for connections that were LOST. The first greeting
      // follows a page the server just rendered, and a planned reconnect
      // follows a swap that just delivered fresh markup — in both cases every
      // region on screen is already current, and refreshing them was four
      // extra round trips per agent switch, buying nothing.
      // A tab that gave its stream back while hidden has a gap even if this is
      // its first greeting (it was hidden before the first one arrived).
      if ((greeted && !planned) || resyncPending) resyncAll('reconnect');
      greeted = true;
      planned = false;
    }
    if (data?.topic) refreshSoon(data.topic);
    // `reload` is NOT handled here: whoever wants to re-render subscribes to it.
    // location.reload() would drop this stream, the chat and every open tab.
  }

  // The same fact, off the request path — and this is the one that fires.
  //
  // A tab that has been sitting in the background is exactly the tab that
  // outlives a restart, and its stream is the first casualty: Chrome throttles
  // the retry timer of a hidden tab to minutes and freezes a discarded one
  // outright, so `hello` never arrives. Meanwhile its htmx requests work
  // perfectly the moment somebody clicks — old javascript against new markup,
  // which is how `window.chat.compose is not a function` gets to a console.
  // Every answer carries the process that gave it, so the first click after a
  // restart is what reloads the page.
  function sawServer(start) {
    if (typeof start !== 'number' || !start) return;
    if (serverStart !== null && serverStart !== start) { location.reload(); return; }
    serverStart = start;
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { es?.close(); } catch {}
    es = null;
  }

  // ── Transport ───────────────────────────────────────────────────────────
  // Over HTTP/1.1 Chrome allows six connections per origin, and an SSE stream
  // holds one for as long as it lives: a handful of background tabs used to eat
  // the pool and freeze every ordinary request (b79a7ce). Over HTTP/2 or HTTP/3
  // all requests of an origin share one multiplexed connection, so a stream
  // costs nothing and a hidden tab keeps receiving events. The page knows which
  // protocol carried it; nothing to configure.
  function keepWhileHidden() {
    const proto = performance.getEntriesByType?.('navigation')?.[0]?.nextHopProtocol || '';
    return proto === 'h2' || proto === 'h3' || proto.startsWith('h3-');
  }
  const mayConnect = () => document.visibilityState === 'visible' || keepWhileHidden();

  function scheduleReconnect() {
    if (!mayConnect() || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 10000);
  }

  function connect() {
    if (!mayConnect()) return;
    disconnect();
    // Ask only for what this tab shows: server-side filtering beats waking up
    // and deciding the event was not ours.
    const want = topics();
    es = new EventSource('/procs/events' + (want.length ? '?topics=' + encodeURIComponent(want.join(',')) : ''));
    es.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      retryMs = 1000;
      handle(data);
    };
    es.onerror = () => {
      disconnect();
      scheduleReconnect();
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      // HTTP/1.1: give the connection back. The reconnect's `hello` on return
      // is the gap signal that makes everyone resync.
      if (!keepWhileHidden()) { disconnect(); resyncPending = true; }
      return;
    }
    retryMs = 1000;
    if (!es) connect();                    // the hello that follows resyncs
    else if (resyncPending && greeted) resyncAll('visible');
    else refreshSoon();                    // regions whose signal arrived while hidden
  });
  // Chrome freezes long-hidden tabs: no events run, the stream may survive.
  // Whatever arrived meanwhile was not processed — treat it as a gap.
  document.addEventListener('resume', () => resyncAll('resume'));
  window.addEventListener('pagehide', disconnect);

  // A region that arrives with a swap may follow a topic nobody was watching —
  // resubscribe so the server knows, and check whether it is already behind.
  // A swap may bring in a region on a topic nobody was watching, so the
  // subscription is refreshed — debounced, because a swap storm must not become
  // a reconnect storm.
  //
  // It deliberately does NOT sweep: a region that just arrived was rendered
  // with the server's current cursor, so it is already up to date. Sweeping
  // here made a request cause a swap, a swap cause a sweep, and a sweep cause a
  // request — two hundred fetches a second, on an idle page.
  let resubscribe = null;
  // `hyper:regions` — the same, for code that puts markup in place itself (the canvas panel).
  const regionsChanged = () => {
    clearTimeout(resubscribe);
    resubscribe = setTimeout(() => {
      const want = topics().join(',');
      if (want === lastTopics) return;
      lastTopics = want;
      planned = true;
      disconnect();
      connect();
    }, 500);
  };
  document.addEventListener('htmx:after:swap', regionsChanged);
  document.addEventListener('hyper:regions', regionsChanged);

  lastTopics = topics().join(',');
  connect();
})();
