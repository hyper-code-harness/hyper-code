import { afterAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { startHeadlessChrome } from "../../test/chrome/headless";

const chrome = await startHeadlessChrome();
const CDP = chrome?.url;
afterAll(async () => { await chrome?.stop(); });
test.skipIf(!CDP)("subscription → deduplicated model → shared account, form-only choice in headless Chrome", async () => {
    const ctx: any = await mkTestCtx();
    let selections = 0;
    ctx.fns.llm.claudePoolSelect = async (opts: any) => {
        if (opts.preferredAccount) selections++;
        return {enabled:true, account:"personal", resetsAt:null, accounts:[{account:"work",available:false,resetsAt:null},{account:"personal",available:true,resetsAt:null}]};
    };
    ctx.fns.llm.listModels = async () => ({"claude-code":["claude-code:sonnet","claude-code:opus"],"anthropic-oauth/work":["anthropic-oauth/work:sonnet"]});
    ctx.fns.llm.listAccounts = async () => [{provider:"anthropic-oauth",account:"work",usedPercent:100,planType:"team"},{provider:"anthropic-oauth",account:"personal",usedPercent:10,planType:"max",needsReconnect:true}];
    ctx.fns.node.list = async () => [];
    const html = await ctx.fns.agent.modelPickerHtml({current:"anthropic-oauth/work:sonnet",mode:"form"});
    const actionHtml = await ctx.fns.agent.modelPickerHtml({current:"claude-code/work:sonnet",agentId:"xx"});
    expect(actionHtml).toContain('&quot;claudeAccount&quot;:&quot;personal&quot;');
    expect(actionHtml).not.toContain('data-model-route="claude-code/work:sonnet"');
    const server = Bun.serve({port:0,hostname:"127.0.0.1",fetch:()=>new Response(`<!doctype html><body>${html}</body>`,{headers:{"content-type":"text/html"}})});
    let tab: any; let ws: WebSocket | undefined;
    try {
        tab = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/`)}`,{method:"PUT"})).json();
        ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((resolve,reject)=>{ws!.onopen=resolve;ws!.onerror=reject;});
        let id=0; const pending = new Map<number,(v:any)=>void>();
        ws.onmessage=e=>{const m=JSON.parse(String(e.data));pending.get(m.id)?.(m.result?.result?.value);};
        const evaluate=(expression:string)=>new Promise<any>(resolve=>{pending.set(++id,resolve);ws!.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression,returnByValue:true}}));});
        for(let i=0;i<100&&!await evaluate("!!document.querySelector('[data-model-picker]')");i++)await Bun.sleep(30);
        const result=await evaluate(`(()=>{
            const tabs=[...document.querySelectorAll('[data-picker-model-tab]')];
            tabs[1].click();
            const panel=[...document.querySelectorAll('[data-picker-model-panel]')].find(p=>!p.hidden);
            const spent=panel.querySelector('[data-claude-account=work]');spent.click();
            const before=document.querySelector('input[name=model]').value;
            panel.querySelector('[data-claude-account=personal]').click();
            return {providers:document.querySelectorAll('[data-model-provider-tab]').length,models:tabs.length,before,route:document.querySelector('input[name=model]').value,account:document.querySelector('input[name=claudeAccount]').value,disabled:spent.getAttribute('aria-disabled'),text:panel.textContent};
        })()`);
        expect(result.providers).toBe(1); expect(result.models).toBe(2);
        expect(result.before).toBe("claude-code:sonnet");expect(result.route).toBe("claude-code:opus");expect(result.account).toBe("personal");expect(result.disabled).toBe("true");
        expect(result.text).toContain("Current shared Claude account: personal");expect(result.text).toContain("ALL chats + relay");expect(result.text).toContain("Quota exhausted");expect(result.text).toContain("90% left");expect(selections).toBe(0);
    } finally { ws?.close(); if(tab) await fetch(`${CDP}/json/close/${tab.id}`); server.stop(true); }
},20000);
