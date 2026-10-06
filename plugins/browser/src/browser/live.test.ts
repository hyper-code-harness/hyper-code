import { expect, test } from "bun:test";
import http from "node:http";
import liveKey from "./liveKey";
import liveMouse from "./liveMouse";
import liveCdp from "./liveCdp";
import liveConnect from "./liveConnect";

const noCtx = {} as Context;

test("liveKey: printable keys carry text, chords and named keys do not", () => {
    expect(liveKey(noCtx, null, { type: "down", key: "a", code: "KeyA", keyCode: 65 })).toMatchObject({ type: "keyDown", key: "a", code: "KeyA", text: "a", windowsVirtualKeyCode: 65 });
    expect(liveKey(noCtx, null, { type: "down", key: "Ф", code: "KeyA", keyCode: 65, modifiers: 8 })).toMatchObject({ type: "keyDown", text: "Ф", modifiers: 8 });
    expect(liveKey(noCtx, null, { type: "down", key: "Enter", code: "Enter", keyCode: 13 })).toMatchObject({ type: "keyDown", text: "\r" });
    const arrow = liveKey(noCtx, null, { type: "down", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 })!;
    expect(arrow.type).toBe("rawKeyDown");
    expect(arrow.text).toBeUndefined();
    const ctrlC = liveKey(noCtx, null, { type: "down", key: "c", code: "KeyC", keyCode: 67, modifiers: 2 })!;
    expect([ctrlC.type, ctrlC.text]).toEqual(["rawKeyDown", undefined]);
    expect(liveKey(noCtx, null, { type: "up", key: "a", code: "KeyA", keyCode: 65 })).toMatchObject({ type: "keyUp", key: "a" });
    expect(liveKey(noCtx, null, { type: "down", key: "😀", code: "", keyCode: 0 })).toMatchObject({ text: "😀" });
});

test("liveKey: editing commands for a macOS Chrome, nothing for IME/dead keys", () => {
    expect(liveKey(noCtx, null, { type: "down", key: "a", code: "KeyA", keyCode: 65, modifiers: 4, remoteMac: true })).toMatchObject({ commands: ["selectAll"] });
    expect(liveKey(noCtx, null, { type: "down", key: "z", code: "KeyZ", keyCode: 90, modifiers: 4 | 8, remoteMac: true })).toMatchObject({ commands: ["redo"] });
    expect(liveKey(noCtx, null, { type: "down", key: "a", code: "KeyA", keyCode: 65, modifiers: 4 })!.commands).toBeUndefined();
    expect(liveKey(noCtx, null, { type: "down", key: "Dead", code: "Quote" })).toBeNull();
    expect(liveKey(noCtx, null, { type: "down", key: "Process", code: "KeyA" })).toBeNull();
});

test("liveMouse: moves keep the held button, presses count clicks, wheel passes deltas", () => {
    expect(liveMouse(noCtx, null, { type: "move", x: 10.5, y: 20 })).toEqual({ type: "mouseMoved", x: 10.5, y: 20, modifiers: 0, buttons: 0, button: "none" });
    expect(liveMouse(noCtx, null, { type: "move", x: 1, y: 2, buttons: 1 })).toMatchObject({ button: "left", buttons: 1 });
    expect(liveMouse(noCtx, null, { type: "move", x: 1, y: 2, buttons: 2 })).toMatchObject({ button: "right" });
    expect(liveMouse(noCtx, null, { type: "down", x: 1, y: 2, button: 0, buttons: 1, clickCount: 2 })).toMatchObject({ type: "mousePressed", button: "left", clickCount: 2 });
    expect(liveMouse(noCtx, null, { type: "up", x: 1, y: 2, button: 2 })).toMatchObject({ type: "mouseReleased", button: "right", clickCount: 1 });
    expect(liveMouse(noCtx, null, { type: "wheel", x: 1, y: 2, deltaY: 120 })).toMatchObject({ type: "mouseWheel", deltaX: 0, deltaY: 120 });
    expect(liveMouse(noCtx, null, { type: "move", x: NaN, y: 2 })).toBeNull();
});

test("liveCdp: default endpoint, allow-list, refusal", async () => {
    const settings: Record<string, string | undefined> = { liveCdpAllow: "http://127.0.0.1:9230/, http://127.0.0.1:9225" };
    const ctx = { env: { CDP_BROWSER_URL: "http://127.0.0.1:9222/" }, fns: { settings: { getString: async (o: any) => settings[o.key] } } } as unknown as Context;
    expect(await liveCdp(ctx, null, {})).toEqual({ browserUrl: "http://127.0.0.1:9222", isDefault: true });
    expect(await liveCdp(ctx, null, { requested: "http://127.0.0.1:9222" })).toEqual({ browserUrl: "http://127.0.0.1:9222", isDefault: true });
    expect(await liveCdp(ctx, null, { requested: "http://127.0.0.1:9230" })).toEqual({ browserUrl: "http://127.0.0.1:9230", isDefault: false });
    await expect(liveCdp(ctx, null, { requested: "http://10.0.0.1:9222" })).rejects.toThrow(/not allowed/);
    (ctx.env as any).CDP_BROWSER_URL = "http://127.0.0.1:29222";
    expect((await liveCdp(ctx, null, {})).browserUrl).toBe("http://127.0.0.1:29222");
});

// A fake Chrome: /json/version over HTTP and a browser-level CDP socket that
// records every command and answers the few liveConnect waits on.
test("liveConnect: screencast frames reach the viewer as header+JPEG and are acked; input and navigation map to CDP", async () => {
    const commands: any[] = [];
    let chrome: any = null;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fake = Bun.serve({
        port: 0, hostname: "127.0.0.1",
        fetch(req, srv) {
            if (new URL(req.url).pathname === "/json/version") return Response.json({ webSocketDebuggerUrl: `ws://localhost:1/devtools/browser/x`, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" });
            return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
        },
        websocket: {
            open(ws) { chrome = ws; },
            message(ws, raw) {
                const m = JSON.parse(String(raw));
                commands.push(m);
                const result: any = m.method === "Target.getTargets"
                    ? { targetInfos: [{ targetId: "T1", type: "page", title: "One", url: "https://one.test/" }, { targetId: "T2", type: "page", title: "Two", url: "https://two.test/" }] }
                    : m.method === "Target.attachToTarget" ? { sessionId: `S-${m.params.targetId}` }
                    : m.method === "Page.getNavigationHistory" ? { currentIndex: 1, entries: [{ id: 7 }, { id: 8 }] }
                    : {};
                ws.send(JSON.stringify({ id: m.id, result }));
            },
        },
    });
    const sent: Array<string | Uint8Array> = [];
    const viewer = { send: (d: any) => { sent.push(d); return 1; }, getBufferedAmount: () => 0, close: () => {} };
    const logged: any[] = [];
    const ctx = { fns: {
        browser: { liveMouse: (o: any) => liveMouse(noCtx, null, o), liveKey: (o: any) => liveKey(noCtx, null, o) },
        procs: { log: { debug: (o: any) => logged.push(o) } },
    } } as unknown as Context;
    // Other test files in the same process swap globalThis.fetch for mocks.
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((u: any) => new Promise<Response>((resolve, reject) => {
        http.get(String(u), (res) => { let body = ""; res.on("data", (c) => body += c); res.on("end", () => resolve(new Response(body))); }).on("error", reject);
    })) as any;
    try {
        const conn = await liveConnect(ctx, null, { viewer, browserUrl: `http://127.0.0.1:${fake.port}`, targetId: "T2", quality: 55 });
        expect(conn.targetId()).toBe("T2");
        const names = commands.map((c) => c.method);
        expect(names).toEqual(expect.arrayContaining(["Target.getTargets", "Target.setDiscoverTargets", "Target.attachToTarget", "Page.enable", "Emulation.setFocusEmulationEnabled", "Page.startScreencast"]));
        expect(commands.find((c) => c.method === "Page.startScreencast")).toMatchObject({ sessionId: "S-T2", params: { format: "jpeg", quality: 55 } });
        // Nothing that would run code inside the page.
        expect(names.some((n) => /^Runtime\.|addScriptToEvaluateOnNewDocument/.test(n))).toBe(false);

        chrome.send(JSON.stringify({ method: "Page.screencastFrame", sessionId: "S-T2", params: { sessionId: 42, data: Buffer.from(jpeg).toString("base64"), metadata: { deviceWidth: 800, deviceHeight: 600, offsetTop: 0, pageScaleFactor: 1 } } }));
        await Bun.sleep(50);
        const frame = sent.find((d) => typeof d !== "string") as Uint8Array;
        const len = new DataView(frame.buffer, frame.byteOffset).getUint32(0);
        expect(JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + len)))).toMatchObject({ deviceWidth: 800, targetId: "T2" });
        expect([...frame.subarray(4 + len)]).toEqual([...jpeg]);
        expect(commands.find((c) => c.method === "Page.screencastFrameAck")).toMatchObject({ sessionId: "S-T2", params: { sessionId: 42 } });

        await conn.handle(JSON.stringify({ t: "mouse", type: "move", x: 5, y: 6 }));
        await conn.handle(JSON.stringify({ t: "key", type: "down", key: "q", code: "KeyQ", keyCode: 81 }));
        await conn.handle(JSON.stringify({ t: "insert", text: "привет" }));
        await conn.handle(JSON.stringify({ t: "navigate", url: "example.org" }));
        await conn.handle(JSON.stringify({ t: "back" }));
        await conn.handle(JSON.stringify({ t: "switch", id: "T1" }));
        await Bun.sleep(50);
        const after = (m: string) => commands.filter((c) => c.method === m);
        expect(after("Input.dispatchMouseEvent")[0]).toMatchObject({ sessionId: "S-T2", params: { type: "mouseMoved", x: 5, y: 6 } });
        expect(after("Input.dispatchKeyEvent")[0]).toMatchObject({ params: { type: "keyDown", key: "q", text: "q" } });
        expect(after("Input.insertText")[0]).toMatchObject({ params: { text: "привет" } });
        expect(after("Page.navigate")[0]).toMatchObject({ params: { url: "https://example.org" } });
        expect(after("Page.navigateToHistoryEntry")[0]).toMatchObject({ params: { entryId: 7 } });
        expect(after("Page.stopScreencast")[0]).toMatchObject({ sessionId: "S-T2" });
        expect(conn.targetId()).toBe("T1");
        expect(after("Page.startScreencast").at(-1)).toMatchObject({ sessionId: "S-T1" });
        expect(conn.stats().inputs).toBe(3);

        await conn.close();
        expect(after("Target.detachFromTarget").length).toBeGreaterThan(0);
    } finally { globalThis.fetch = realFetch; fake.stop(true); }
});
