import { afterEach, expect, test } from "bun:test";
import scope from "./scope";
import session from "./session";
import send from "./send";
import tabs from "../browser/tabs";

const originalWS = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.WebSocket = originalWS; globalThis.fetch = originalFetch; });
const binding = { bindingId: "b", targetId: "target-A", cdpSessionName: "sidebar:b", state: "active" };
function context(value: any = binding) {
    const caller = { agentId: "agent-A" } as any;
    const ctx = { env: {}, state: {}, fns: { sidebar: { bindingForAgent: async () => value }, cdp: {} } } as any;
    ctx.fns.cdp.scope = (opts: any) => scope(ctx, caller, opts);
    ctx.fns.cdp.session = (opts: any) => session(ctx, caller, opts);
    return { ctx, caller };
}

test("binding selects default and rejects explicit mismatches", async () => {
    const {ctx,caller} = context();
    expect(await scope(ctx,caller,{})).toEqual({session:"sidebar:b",targetId:"target-A",bound:true});
    await expect(scope(ctx,caller,{session:"main"})).rejects.toThrow("does not match");
    await expect(scope(ctx,caller,{targetId:"target-B"})).rejects.toThrow("does not match");
    expect((await scope(ctx,caller,{session:"sidebar:b",targetId:"target-A"})).bound).toBe(true);
});
for (const state of ["closed","revoked","unavailable"]) test(`${state} fails closed`, async () => {
    const {ctx,caller} = context({...binding,state});
    await expect(scope(ctx,caller,{})).rejects.toThrow(state);
});
test("ordinary sessions keep legacy selection", async () => {
    const {ctx,caller} = context(null);
    expect(await scope(ctx,caller,{session:"main"})).toEqual({session:"main",targetId:undefined,bound:false});
});
test("bound tab discovery filters other targets", async () => {
    const {ctx,caller} = context();
    globalThis.fetch = (async () => Response.json([{id:"target-A",type:"page",url:"a",title:"A"},{id:"target-B",type:"page",url:"b",title:"B"}])) as any;
    expect(await tabs(ctx,caller,{})).toEqual([{id:"target-A",url:"a",title:"A"}]);
});
test("named reconnect preserves target without createTarget and close rejects pending", async () => {
    const urls: string[]=[];
    class WS {
        static OPEN=1; readyState=0; onopen:any; onclose:any; onmessage:any; onerror:any;
        constructor(url:string) { urls.push(url); queueMicrotask(()=>{this.readyState=1;this.onopen?.();}); }
        close(){this.readyState=3;this.onclose?.();}
        send(){}
    }
    globalThis.WebSocket=WS as any;
    globalThis.fetch = (async()=>{throw new Error("must not create tab");}) as any;
    const {ctx,caller}=context(null);
    ctx.state.cdp={sessions:new Map([["named",{targetId:"target-A",ws:{readyState:3}}]])};
    const h=await session(ctx,caller,{name:"named"});
    const pending=send(ctx,caller,{session:"named",method:"Input.insertText",params:{text:"x"}});
    await Bun.sleep(0);h.ws.close();
    await expect(pending).rejects.toThrow("outcome may be unknown");
    await session(ctx,caller,{name:"named"});
    expect(urls).toEqual(["ws://127.0.0.1:9222/devtools/page/target-A","ws://127.0.0.1:9222/devtools/page/target-A"]);
});
test("failed mutating command is never retried", async () => {
    const {ctx,caller}=context(null); let sends=0; let connections=0;
    const handle={msgId:0,pending:new Map(),ws:{send(){sends++;throw new Error("uncertain");}}};
    ctx.fns.cdp.session=async()=>{connections++;return handle;};
    await expect(send(ctx,caller,{method:"Input.insertText",params:{text:"x"}})).rejects.toThrow("uncertain");
    expect(sends).toBe(1); expect(connections).toBe(1); expect(handle.pending.size).toBe(0);
});
test("bound low-level CDP rejects browser-wide target commands",async()=>{
    const {ctx,caller}=context();
    await expect(send(ctx,caller,{method:"Target.createTarget"})).rejects.toThrow("Browser-wide");
});

// Fake Chrome: /json/version answers only while `up`; the browser socket hands out
// a new target per createTarget; page sockets open only for targets of the
// current browser generation (a restarted Chrome forgets the old tabs).
function fakeChrome() {
    const chrome = { up: false, generation: 0, ensured: 0, created: 0 };
    globalThis.fetch = (async () => {
        if (!chrome.up) throw new Error("connection refused");
        return Response.json({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x" });
    }) as any;
    class WS {
        static OPEN = 1; readyState = 0; onopen: any; onclose: any; onmessage: any; onerror: any;
        constructor(readonly url: string) {
            queueMicrotask(() => {
                const page = /\/devtools\/page\/(g(\d+)-t\d+)/.exec(url);
                if (!chrome.up || (page && Number(page[2]) !== chrome.generation)) { this.onerror?.(); return; }
                this.readyState = 1; this.onopen?.();
            });
        }
        send(raw: string) {
            const m = JSON.parse(raw);
            if (m.method === "Target.createTarget") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: m.id, result: { targetId: `g${chrome.generation}-t${++chrome.created}` } }) }));
        }
        close() { this.readyState = 3; this.onclose?.(); }
    }
    globalThis.WebSocket = WS as any;
    return chrome;
}

test("Chrome down: the first browser call starts it and opens a tab", async () => {
    const chrome = fakeChrome();
    const { ctx, caller } = context(null);
    ctx.fns.chrome = { ensure: async () => { chrome.ensured++; chrome.up = true; chrome.generation++; } };
    const h = await session(ctx, caller, { name: "main" });
    expect(chrome.ensured).toBe(1);
    expect(h.targetId).toBe("g1-t1");
});

test("Chrome restarted under a remembered tab: start it again and open a fresh tab", async () => {
    const chrome = fakeChrome();
    chrome.up = true; chrome.generation = 1;
    const { ctx, caller } = context(null);
    ctx.fns.chrome = { ensure: async () => { chrome.ensured++; chrome.up = true; chrome.generation++; } };
    const first = await session(ctx, caller, { name: "main" });
    first.ws.close();
    chrome.up = false; // the user quit Chrome
    const again = await session(ctx, caller, { name: "main" });
    expect(chrome.ensured).toBe(1);
    expect(again.targetId).toBe("g2-t2");
});

test("CDP_AUTOSTART=0 keeps the old behaviour: no start, a clear error", async () => {
    const chrome = fakeChrome();
    const { ctx, caller } = context(null);
    ctx.env.CDP_AUTOSTART = "0";
    ctx.fns.chrome = { ensure: async () => { chrome.ensured++; } };
    await expect(session(ctx, caller, { name: "main" })).rejects.toThrow("Chrome CDP unavailable");
    expect(chrome.ensured).toBe(0);
});

test("concurrent callers share one Chrome recovery and keep each other's new tabs", async () => {
    const chrome = fakeChrome();
    const { ctx, caller } = context(null);
    ctx.fns.chrome = { ensure: async () => { chrome.ensured++; await Bun.sleep(20); chrome.up = true; chrome.generation++; } };
    const [a, b] = await Promise.all([session(ctx, caller, { name: "a" }), session(ctx, caller, { name: "b" })]);
    expect(chrome.ensured).toBe(1);
    const sessions = ctx.state.cdp.sessions;
    expect(sessions.get("a")).toBe(a);
    expect(sessions.get("b")).toBe(b);
    expect(a.ws.readyState).toBe(1);
    expect(b.ws.readyState).toBe(1);
});
