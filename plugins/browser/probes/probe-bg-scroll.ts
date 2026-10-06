// Manual probe: a background tab under focus emulation — do input and screencast keep working?
const base = process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9230";
const put = (p: string) => fetch(base + p, { method: "PUT" }).then(r => r.json());
const bgTab: any = await put("/json/new?https://en.wikipedia.org/wiki/Web_browser");
const fgTab: any = await put("/json/new?https://example.com");
await Bun.sleep(2500);
const ws = new WebSocket(bgTab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const waits = new Map<number, Function>(); let frames = 0; let lastScroll = -1;
const send = (method: string, params = {}) => new Promise<any>(res => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id) waits.get(m.id)?.(m); if (m.method === "Page.screencastFrame") { frames++; lastScroll = m.params.metadata.scrollOffsetY; send("Page.screencastFrameAck", { sessionId: m.params.sessionId }); } };
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.startScreencast", { format: "jpeg", quality: 70 });
await Bun.sleep(800); console.log("initial frames", frames, "scrollY", lastScroll);
for (let i = 0; i < 5; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 400, deltaX: 0, deltaY: 300 }); await Bun.sleep(150); }
await Bun.sleep(800); console.log("after wheel frames", frames, "scrollY in frame", lastScroll);
const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 50 }); console.log("captureScreenshot bytes", shot.result?.data?.length, shot.error);
ws.close(); await fetch(base + "/json/close/" + bgTab.id); await fetch(base + "/json/close/" + fgTab.id);
