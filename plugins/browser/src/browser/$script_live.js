// Live view client: draws Chrome's screencast frames on a canvas and sends the
// viewer's pointer, wheel and keyboard back over /browser/live/socket. Runs only
// on the viewer page — nothing here ever reaches the page being shown.
(() => {
    const $ = (id) => document.getElementById(id);
    const canvas = $("lv-screen"), g = canvas.getContext("2d");
    const tabs = $("lv-tabs"), address = document.querySelector("#lv-nav input[name=url]"), status = $("lv-status");
    const params = new URLSearchParams(location.search);
    let target = params.get("target") || "";
    let ws = null, meta = null, decoding = false, latest = null, retry = 1000, lastError = "", opened = false;
    // What the status pill and the info panel show: the socket to Hyper, the last
    // health report from the server (Chrome's answer time) and when a frame came.
    const diag = { socket: "connecting", openedAt: 0, lastFrameAt: 0, health: null, closes: 0, lastClose: "" };
    const stage = canvas.parentElement;

    // The pill carries a short, stable word; the full reason lives in the info panel (and the
    // pill's tooltip), so a reconnect loop does not make the toolbar jump. Nothing is laid over
    // the picture: a stale picture is only greyed out.
    // The pill is a w.dot with its word: ok → done (green), wait → waiting, bad → error.
    const dotState = { ok: "done", wait: "waiting", bad: "error" };
    const statusDot = status.querySelector(".w-dot"), statusWord = status.querySelector(".w-dot-label > span:last-child");
    const setStatus = (text, cls, detail) => {
        if (statusWord.textContent !== text) statusWord.textContent = text;
        status.dataset.state = cls || "";
        statusDot.dataset.state = dotState[cls] || "idle";
        status.title = detail ? `${detail} — click for details` : "Connection details";
        renderInfo();
    };
    const showBanner = (text) => { stage.dataset.stale = text ? "1" : ""; };
    // "live" only when Chrome answers; a static page sends no frames, so the
    // server's health ping (every 3 s) is the proof of life, frames are a bonus.
    function judge() {
        if (diag.socket !== "open") return;
        const h = diag.health;
        const quiet = h ? Date.now() - diag.lastHealthAt : Date.now() - diag.openedAt;
        if (!h && quiet < 8000) { if (status.dataset.state !== "bad") setStatus("connecting", "wait"); return; }
        if (!h || quiet > 8000) { lastError = `no report from Chrome for ${Math.round(quiet / 1000)} s`; setStatus("Chrome not responding", "bad", lastError); showBanner("stale"); return; }
        if (!h.ok) { lastError = h.error; setStatus("Chrome not responding", "bad", h.error); showBanner("stale"); return; }
        if (!h.attached) { setStatus("reattaching", "wait"); return; }
        setStatus(h.chromeMs > 1000 ? "slow" : "live", h.chromeMs > 1000 ? "wait" : "ok", h.chromeMs > 1000 ? `Chrome answers in ${(h.chromeMs / 1000).toFixed(1)} s` : "");
        showBanner("");
    }
    setInterval(judge, 1000);
    const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    const modifiers = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

    function connect() {
        const q = new URLSearchParams();
        if (target) q.set("target", target);
        if (params.get("cdp")) q.set("cdp", params.get("cdp"));
        ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/browser/live/socket?${q}`);
        ws.binaryType = "arraybuffer";
        opened = false;
        diag.socket = "connecting"; diag.health = null;
        // While retrying after a failure the pill keeps saying so instead of blinking "connecting".
        if (status.dataset.state !== "bad") setStatus("connecting", "wait");
        // The backoff is reset only by a healthy report, not by the socket opening: a server that
        // accepts and then fails to reach Chrome must not turn into a reconnect loop.
        ws.onopen = () => { opened = true; diag.socket = "open"; diag.openedAt = Date.now(); sendView(); };
        ws.onclose = (e) => {
            diag.socket = "closed"; diag.closes++; diag.lastClose = `${e.code}${e.reason ? " " + e.reason : ""}`;
            if (e.code === 4000) { setStatus("stopped — reload the page to view again", "bad"); return; }
            // The server explains a failed attach in an error message before closing; keep it visible.
            // Never opened and no server message: the handshake itself was refused on the way
            // (a proxy or an HTTPS port without HTTP/1.1), not a Chrome problem.
            const why = lastError || (e.reason ? "disconnected: " + e.reason
                : opened ? "disconnected" : `WebSocket blocked: the connection to ${location.host} never opened (refused by the server, a proxy, or an HTTPS port without HTTP/1.1)`);
            lastError = why;
            setStatus(opened ? "offline" : "blocked", "bad", `${why} — retrying`);
            showBanner("stale");
            // 1 s, 2 s, 4 s … up to 30 s, with jitter so several viewers do not hit together.
            const wait = Math.round(retry * (0.8 + Math.random() * 0.4));
            diag.nextRetryAt = Date.now() + wait;
            setTimeout(connect, wait);
            retry = Math.min(retry * 2, 30000);
        };
        ws.onmessage = (e) => {
            if (typeof e.data !== "string") { diag.lastFrameAt = Date.now(); latest = e.data; if (!decoding) draw(); return; }
            const m = JSON.parse(e.data);
            if (m.t === "tabs") renderTabs(m.tabs, m.current);
            else if (m.t === "target") {
                target = m.id;
                if (document.activeElement !== address) address.value = m.url || "";
                document.title = (m.title || m.url || "Live view") + " — live";
                const u = new URL(location.href); u.searchParams.set("target", m.id); history.replaceState(null, "", u);
            } else if (m.t === "nav") { if (document.activeElement !== address) address.value = m.url || ""; }
            else if (m.t === "profile") quality.title = `${m.mode} · JPEG ${m.quality}${m.maxWidth ? ` · ≤${m.maxWidth}×${m.maxHeight}` : ""}`;
            else if (m.t === "error") { lastError = m.message; setStatus("error", "bad", m.message); }
            else if (m.t === "health") { diag.health = m; diag.lastHealthAt = Date.now(); if (m.ok) { lastError = ""; retry = 1000; } judge(); }
        };
    }

    // Frames: [u32 header length][JSON metadata][JPEG]. Decode only the newest;
    // frames that arrive while one is decoding replace each other.
    async function draw() {
        decoding = true;
        while (latest) {
            const buf = latest; latest = null;
            const len = new DataView(buf).getUint32(0);
            meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
            try {
                const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, 4 + len)], { type: "image/jpeg" }));
                if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; fit(); }
                g.drawImage(bmp, 0, 0);
                bmp.close();
            } catch { /* a broken frame: wait for the next */ }
        }
        decoding = false;
    }

    // Show the frame as large as the box allows, keeping its aspect: a frame
    // Chrome scaled down for speed is stretched back up here.
    function fit() {
        const main = canvas.parentElement;
        const k = Math.min(main.clientWidth / canvas.width, main.clientHeight / canvas.height);
        canvas.style.width = `${Math.floor(canvas.width * k)}px`;
        canvas.style.height = `${Math.floor(canvas.height * k)}px`;
    }

    // Tabs menu: "New tab" (drawn by the server) first; then Chrome's open tabs as w.listRow rows, the shown one current.
    const tabMenu = $("lv-tabmenu"), tabList$ = $("lv-tablist"), tabsLabel = tabs.querySelector("span");
    let tabList = [], tabCurrent = "";
    const closePops = () => { for (const p of document.querySelectorAll("[popover]")) { try { p.hidePopover(); } catch {} } };
    function renderTabs(list, current) {
        tabList = list; tabCurrent = current;
        const cur = list.find((t) => t.id === current);
        tabsLabel.textContent = cur ? (cur.title || cur.url || "Tab") : "Tabs";
        tabs.title = `${list.length} Chrome tab${list.length === 1 ? "" : "s"}`;
        tabList$.replaceChildren(...list.map((t) => {
            const b = document.createElement("button");
            b.type = "button"; b.className = "w-row"; b.title = t.url || "";
            if (t.id === current) b.setAttribute("aria-current", "page");
            const lead = document.createElement("span"); lead.className = "w-row-lead";
            const icon = document.createElement("i"); icon.className = "w-icon ph ph-browser"; icon.dataset.size = "16"; icon.setAttribute("aria-hidden", "true");
            lead.append(icon);
            const text = document.createElement("span"); text.className = "w-row-text";
            const label = document.createElement("span"); label.className = "w-row-label"; label.textContent = t.title || t.url || t.id;
            const detail = document.createElement("span"); detail.className = "w-row-detail"; detail.textContent = t.url;
            text.append(label, detail);
            b.append(lead, text);
            b.onclick = () => { closePops(); if (t.id !== tabCurrent) send({ t: "switch", id: t.id }); canvas.focus(); };
            return b;
        }));
    }
    tabMenu.querySelector("[data-live-new]").onclick = () => { closePops(); send({ t: "new" }); address.value = ""; address.focus(); };

    // Canvas position → page CSS pixels. The canvas keeps the frame's aspect, so
    // one scale per axis from its drawn box to the frame's device size.
    function point(e) {
        const r = canvas.getBoundingClientRect();
        const w = meta?.deviceWidth || canvas.width, h = meta?.deviceHeight || canvas.height;
        const scale = meta?.pageScaleFactor || 1;
        return {
            x: Math.round(((e.clientX - r.left) / r.width) * w / scale * 100) / 100,
            y: Math.round((((e.clientY - r.top) / r.height) * h - (meta?.offsetTop || 0)) / scale * 100) / 100,
        };
    }
    const mouse = (type, e, extra = {}) => send({ t: "mouse", type, ...point(e), button: e.button, buttons: e.buttons, modifiers: modifiers(e), ...extra });

    // Every movement goes through, coalesced samples included: a human's real
    // trajectory is what anti-bot checks look at.
    canvas.addEventListener("pointermove", (e) => {
        const all = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const c of all.length ? all : [e]) mouse("move", c, { buttons: e.buttons, modifiers: modifiers(e) });
    });
    // A button pressed on the canvas is released to the page even when the
    // pointer left the canvas meanwhile (drag out of the picture).
    let pressed = 0;
    canvas.addEventListener("mousedown", (e) => { canvas.focus(); e.preventDefault(); pressed |= 1 << e.button; mouse("down", e, { clickCount: e.detail || 1 }); });
    window.addEventListener("mouseup", (e) => { if (!(pressed & (1 << e.button))) return; pressed &= ~(1 << e.button); mouse("up", e, { clickCount: e.detail || 1 }); });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
        mouse("wheel", e, { deltaX: e.deltaX * k, deltaY: e.deltaY * k });
    }, { passive: false });

    // Keyboard: the viewer is a browser, so key/code/keyCode are already right.
    const isPaste = (e) => (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "v";
    const key = (type, e) => send({ t: "key", type, key: e.key, code: e.code, keyCode: e.keyCode, location: e.location, modifiers: modifiers(e), repeat: e.repeat });
    canvas.addEventListener("keydown", (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (isPaste(e)) return;            // let the viewer's own paste happen; see "paste" below
        e.preventDefault();
        key("down", e);
    });
    canvas.addEventListener("keyup", (e) => { if (e.isComposing || isPaste(e)) return; e.preventDefault(); key("up", e); });
    canvas.addEventListener("compositionend", (e) => { if (e.data) send({ t: "insert", text: e.data }); });
    // Paste from the viewer's clipboard arrives as typed text (Input.insertText).
    canvas.addEventListener("paste", (e) => { const text = e.clipboardData?.getData("text/plain"); if (text) { e.preventDefault(); send({ t: "insert", text }); } });

    // Picture profile: the box the picture is shown in (Chrome scales frames to
    // it before encoding) and the viewer's quality choice, remembered locally.
    const quality = $("lv-quality"), main = canvas.parentElement;
    quality.value = localStorage.getItem("browser.live.quality") || "auto";
    const sendView = () => send({ t: "view", mode: quality.value, width: Math.round(main.clientWidth), height: Math.round(main.clientHeight), dpr: window.devicePixelRatio || 1 });
    quality.onchange = () => { localStorage.setItem("browser.live.quality", quality.value); sendView(); canvas.focus(); };
    let resizeTimer = null;
    new ResizeObserver(() => { fit(); clearTimeout(resizeTimer); resizeTimer = setTimeout(sendView, 250); }).observe(main);

    // Info panel: the whole path at a glance — what to look at when the picture is wrong.
    const info = $("lv-info"), infoList = $("lv-info-list");
    const ago = (t) => t ? `${((Date.now() - t) / 1000).toFixed(1)} s ago` : "never";
    function renderInfo() {
        if (!info || !info.matches(":popover-open")) return;
        const h = diag.health || {};
        const rows = [
            ["Page", location.host],
            ["Socket", `${diag.socket}${diag.closes ? ` · ${diag.closes} reconnects, last ${diag.lastClose}` : ""}${diag.socket === "closed" && diag.nextRetryAt > Date.now() ? ` · retry in ${Math.ceil((diag.nextRetryAt - Date.now()) / 1000)} s` : ""}`, diag.socket === "open" ? "ok" : "bad"],
            ["Chrome", h.browserUrl ? `${h.browserUrl} · ${h.chrome || "?"}` : "—"],
            ["Answers in", h.ok === false ? `no answer: ${h.error}` : h.chromeMs >= 0 ? `${h.chromeMs} ms` : "—", h.ok === false ? "bad" : h.chromeMs >= 0 ? "ok" : ""],
            ["Last report", ago(diag.lastHealthAt)],
            ["Tab", h.target ? `${h.target.slice(0, 8)} · ${h.attached ? "attached" : "detached"}` : "—", h.attached === false ? "bad" : ""],
            ["URL", h.url || "—"],
            ["Frames", h.frames != null ? `${h.frames} · dropped ${h.dropped} · last ${ago(diag.lastFrameAt)}` : "—"],
            ["Picture", h.mode ? `${h.mode} · level ${h.level} · JPEG ${h.quality}${h.maxWidth ? ` · ≤${h.maxWidth}×${h.maxHeight}` : ""}` : "—"],
            ["Input", h.inputs != null ? `${h.inputs} events` : "—"],
            ["Error", lastError || "—", lastError ? "bad" : ""],
        ];
        // w.keyValue markup: <dl class="w-kv"><div><dt/><dd/></div>…; a bad value is danger, a good one success.
        const dl = infoList.querySelector(".w-kv");
        dl.replaceChildren(...rows.map(([k, v, cls]) => {
            const row = document.createElement("div");
            const dt = document.createElement("dt"); dt.textContent = k;
            const dd = document.createElement("dd"); dd.textContent = v;
            if (cls) dd.dataset.tone = cls === "bad" ? "danger" : "success";
            row.append(dt, dd);
            return row;
        }));
    }
    setInterval(renderInfo, 1000);
    info.addEventListener("toggle", renderInfo);

    $("lv-back").onclick = () => send({ t: "back" });
    $("lv-forward").onclick = () => send({ t: "forward" });
    $("lv-reload").onclick = () => send({ t: "reload" });
    // The address is a w.addressBar form: Enter submits it.
    $("lv-nav").addEventListener("submit", (e) => { e.preventDefault(); send({ t: "navigate", url: address.value }); canvas.focus(); });
    const pasteBox = $("lv-paste"), pasteText = $("lv-paste-text");
    pasteBox.addEventListener("toggle", (e) => { if (e.newState === "open") pasteText.focus(); });
    $("lv-paste-send").onclick = () => {
        const text = pasteText.value;
        if (text) send({ t: "insert", text });
        pasteText.value = ""; closePops(); canvas.focus();
    };
    // Popovers close on Escape and outside clicks by themselves; back to the picture after either.
    for (const p of document.querySelectorAll("[popover]")) p.addEventListener("toggle", (e) => { if (e.newState === "closed" && !document.querySelector(":popover-open")) canvas.focus({ preventScroll: true }); });

    connect();
    canvas.focus();
})();
