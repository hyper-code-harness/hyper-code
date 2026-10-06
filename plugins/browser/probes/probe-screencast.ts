// Manual probe: does Page.startScreencast deliver frames from a foreground and from a background tab?
const base = process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9230";
const put = (p: string) => fetch(base + p, { method: "PUT" }).then(r => r.json());
const fg: any = await put("/json/new?https://example.com");
const bg: any = await put("/json/new?https://duckduckgo.com");   // opened last → foreground; fg now background
await Bun.sleep(1500);
async function count(t: any, focusEmu: boolean) {
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0, frames = 0, meta: any = null; const send = (method: string, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.method === "Page.screencastFrame") { frames++; meta = m.params.metadata; send("Page.screencastFrameAck", { sessionId: m.params.sessionId }); } };
  if (focusEmu) send("Emulation.setFocusEmulationEnabled", { enabled: true });
  send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  await Bun.sleep(1500); ws.close(); return { frames, meta };
}
console.log("foreground (ddg):", await count(bg, false));
console.log("background (example):", await count(fg, false));
console.log("background + focusEmulation:", await count(fg, true));
await fetch(base + "/json/close/" + fg.id); await fetch(base + "/json/close/" + bg.id);
