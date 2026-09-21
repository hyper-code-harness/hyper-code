import { watch } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] || "browser-extension");
const browserUrl = (process.env.CDP_BROWSER_URL || "http://127.0.0.1:9222").replace(/\/$/, "");
const once = process.argv.includes("--once");

async function cdp(wsUrl: string, method: string, params: Record<string, unknown> = {}) {
  return await new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${method} timed out`)); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP connection failed")); };
  });
}

async function reload() {
  const response = await fetch(`${browserUrl}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Chrome CDP returned HTTP ${response.status}`);
  const targets: any[] = await response.json();
  const worker = targets.find(target =>
    target.type === "service_worker" &&
    String(target.url).startsWith("chrome-extension://") &&
    String(target.url).endsWith("/worker.js")
  );
  if (!worker?.webSocketDebuggerUrl) {
    throw new Error("Hyper extension worker is not active; open its sidebar once and retry");
  }
  await cdp(worker.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: "chrome.runtime.reload()",
    awaitPromise: false,
  });
  console.log(`[extension] reloaded ${new Date().toLocaleTimeString()}`);
}

if (once) {
  await reload();
  process.exit(0);
}

console.log(`[extension] watching ${dir}`);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(dir, { recursive: true }, (_event, file) => {
  if (!file || file.endsWith("~") || file.includes(".DS_Store")) return;
  clearTimeout(timer);
  timer = setTimeout(() => reload().catch(error => console.error(`[extension] ${error.message}`)), 250);
});
await new Promise(() => {});
