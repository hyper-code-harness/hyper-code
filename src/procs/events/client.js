(() => {
  if (window.__hyperEventsInstalled) return;
  window.__hyperEventsInstalled = true;

  let es;
  let reconnectTimer = null;
  let retryMs = 1000;
  let lastTopics = '';
  let greeted = false;
  let planned = false;   // we closed the stream ourselves (the topic set changed)

  function emitDomEvent(data) {
    document.dispatchEvent(new CustomEvent('hyper-events', { detail: data }));
  }

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
    emitDomEvent(data);
    // Server restarted under us — reload to pick up the new process.
    if (data?.type === 'hello') {
      sawServer(data.serverStart);
      // Catching up is for connections that were LOST. The first greeting
      // follows a page the server just rendered, and a planned reconnect
      // follows a swap that just delivered fresh markup — in both cases every
      // region on screen is already current, and refreshing them was four
      // extra round trips per agent switch, buying nothing.
      if (greeted && !planned) for (const topic of data.refresh ?? topics()) refreshSoon(topic);
      greeted = true;
      planned = false;
    }
    if (data?.topic) refreshSoon(data.topic);
    // `reload` is NOT handled here. emitDomEvent already dispatched it as a
    // `hyper-events` DOM event, and whoever wants to re-render says so with an
    // hx-trigger on that event — the same way #chat and #chat-who do. A page
    // that cannot express it that way (no htmx) still has the DOM event.
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

  function scheduleReconnect() {
    if (document.visibilityState !== 'visible' || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 10000);
  }

  function connect() {
    // Hidden tabs must not retain permanent HTTP/1 connections. Chrome permits
    // only a small number per origin; enough background SSE streams can consume
    // the pool and make every ordinary HTMX/fetch request look frozen.
    if (document.visibilityState !== 'visible') return;
    disconnect();
    // Ask only for what this tab shows: server-side filtering beats waking up
    // and deciding the event was not ours.
    const want = topics();
    es = new EventSource('/procs/events' + (want.length ? '?topics=' + encodeURIComponent(want.join(',')) : ''));
    es.onmessage = (e) => {
      try { handle(JSON.parse(e.data)); retryMs = 1000; } catch {}
    };
    es.onerror = () => {
      disconnect();
      scheduleReconnect();
    };
  }

  // Only the visible tab owns an SSE socket. A hidden tab catches up through
  // the live-region refresh below when selected again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { disconnect(); return; }
    for (const topic of topics()) refreshSoon(topic);
    retryMs = 1000;
    connect();
  });
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
  document.addEventListener('htmx:after:swap', () => {
    clearTimeout(resubscribe);
    resubscribe = setTimeout(() => {
      const want = topics().join(',');
      if (want === lastTopics) return;
      lastTopics = want;
      planned = true;
      disconnect();
      connect();
    }, 500);
  });

  lastTopics = topics().join(',');
  connect();
})();
