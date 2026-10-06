// Live view client: draws Chrome's screencast frames on a canvas and sends the
// viewer's pointer, wheel and keyboard back over /browser/live/socket. Runs only
// on the viewer page — nothing here ever reaches the page being shown.
(() => {
    const $ = (id) => document.getElementById(id);
    const canvas = $("lv-screen"), g = canvas.getContext("2d");
    const tabs = $("lv-tabs"), address = $("lv-address"), status = $("lv-status");
    const params = new URLSearchParams(location.search);
    let target = params.get("target") || "";
    let ws = null, meta = null, decoding = false, latest = null, retry = 500;

    const setStatus = (text, cls) => { status.textContent = text; status.dataset.state = cls || ""; };
    const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    const modifiers = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

    function connect() {
        const q = new URLSearchParams();
        if (target) q.set("target", target);
        if (params.get("cdp")) q.set("cdp", params.get("cdp"));
        ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/browser/live/socket?${q}`);
        ws.binaryType = "arraybuffer";
        setStatus("connecting…", "wait");
        ws.onopen = () => { retry = 500; setStatus("live", "ok"); };
        ws.onclose = (e) => {
            if (e.code === 4000) { setStatus("stopped — reload the page to view again", "bad"); return; }
            setStatus(`disconnected${e.reason ? ": " + e.reason : ""} — retrying`, "bad");
            setTimeout(connect, retry);
            retry = Math.min(retry * 2, 8000);
        };
        ws.onmessage = (e) => {
            if (typeof e.data !== "string") { latest = e.data; if (!decoding) draw(); return; }
            const m = JSON.parse(e.data);
            if (m.t === "tabs") renderTabs(m.tabs, m.current);
            else if (m.t === "target") {
                target = m.id;
                if (document.activeElement !== address) address.value = m.url || "";
                document.title = (m.title || m.url || "Live view") + " — live";
                const u = new URL(location.href); u.searchParams.set("target", m.id); history.replaceState(null, "", u);
            } else if (m.t === "nav") { if (document.activeElement !== address) address.value = m.url || ""; }
            else if (m.t === "error") setStatus(m.message, "bad");
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
                if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; }
                g.drawImage(bmp, 0, 0);
                bmp.close();
            } catch { /* a broken frame: wait for the next */ }
        }
        decoding = false;
    }

    function renderTabs(list, current) {
        tabs.replaceChildren(...list.map((t) => {
            const o = document.createElement("option");
            o.value = t.id; o.textContent = (t.title || t.url || t.id).slice(0, 80); o.title = t.url;
            o.selected = t.id === current;
            return o;
        }));
    }

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

    $("lv-back").onclick = () => send({ t: "back" });
    $("lv-forward").onclick = () => send({ t: "forward" });
    $("lv-reload").onclick = () => send({ t: "reload" });
    tabs.onchange = () => { send({ t: "switch", id: tabs.value }); canvas.focus(); };
    address.addEventListener("keydown", (e) => { if (e.key === "Enter") { send({ t: "navigate", url: address.value }); canvas.focus(); } });
    const pasteBox = $("lv-paste");
    $("lv-insert").onclick = () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) $("lv-paste-text").focus(); };
    $("lv-paste-send").onclick = () => {
        const text = $("lv-paste-text").value;
        if (text) send({ t: "insert", text });
        $("lv-paste-text").value = ""; pasteBox.hidden = true; canvas.focus();
    };

    connect();
    canvas.focus();
})();
