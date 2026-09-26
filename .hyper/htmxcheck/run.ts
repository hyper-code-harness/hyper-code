// Browser smoke suite for the htmx 2 → 4 migration. Drives a real Chrome over the
// browser plugin through the key UI flows and reports per-scenario facts plus any
// JS/htmx errors captured in the page. Compare against .hyper/htmx-migration/baseline.json.

type Scenario = { name: string; ok: boolean; v?: unknown; errs?: string[]; url?: string; err?: string; shot?: string };

/**
 * Run the htmx migration browser smoke scenarios against the local Hyper UI and
 * return per-scenario observations with captured page errors. Use after each
 * migration step to detect regressions against the recorded baseline.
 * @param opts.base Origin of the running Hyper server. @default http://localhost:3010
 * @param opts.session Browser session name to drive. @default htmxcheck
 * @param opts.only Scenario names to run; all when omitted.
 * @param opts.screenshots Capture a screenshot after each scenario. @default false
 * @param opts.send Also create a haiku agent and check a streamed reply. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Origin of the running Hyper server. @default http://localhost:3010 */ base?: string;
    /** Browser session name to drive. @default htmxcheck */ session?: string;
    /** Scenario names to run; all when omitted. */ only?: string[];
    /** Capture a screenshot after each scenario. @default false */ screenshots?: boolean;
    /** Also create a haiku agent and check a streamed reply. @default false */ send?: boolean;
}): Promise<Scenario[]> {
    const base = opts.base ?? "http://localhost:3010";
    const S = opts.session ?? "htmxcheck";
    const B: any = (ctx.fns as any).browser;
    const hookFile: any = await ctx.fns.files.read({ path: ".hyper/htmx-migration/hook.js" });
    const hook = typeof hookFile === "string" ? hookFile : hookFile.content;
    const ev = (e: string) => B.evaluate({ session: S, expression: e });
    const J = async (e: string) => JSON.parse(await ev(`JSON.stringify(${e})`));
    // Runs in a background ("shadow") tab and never steals the user's window.
    // A background tab reports visibilityState=hidden, and the SSE client then
    // deliberately stays disconnected, so live updates would look broken. Emulate
    // a visible, focused page instead of calling Page.bringToFront.
    const cdp = (method: string, params?: Record<string, unknown>) => (ctx.fns as any).cdp.send({ session: S, method, params }).catch(() => {});
    let emulated = false;
    const go = async (path: string) => {
        if (!emulated) {
            await B.navigate({ session: S, url: "about:blank" });
            await cdp("Page.enable");
            await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(Document.prototype,'visibilityState',{get:()=>'visible'});Object.defineProperty(Document.prototype,'hidden',{get:()=>false});Document.prototype.hasFocus=()=>true;" });
            await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            emulated = true;
        }
        await B.navigate({ session: S, url: base + path });
        await Bun.sleep(1800); await ev(hook);
    };
    const out: Scenario[] = [];
    const want = (n: string) => !opts.only || opts.only.includes(n);
    const step = async (name: string, fn: () => Promise<unknown>) => {
        if (!want(name)) return;
        try {
            const v = await fn();
            await Bun.sleep(800);
            const e = await J("{url:location.href,errs:(window.__errs||[]).splice(0)}");
            const row: Scenario = { name, ok: true, v, ...e };
            if (opts.screenshots) { const sc: any = await B.screenshot({ session: S }); row.shot = sc?.path ?? String(sc); }
            out.push(row);
        } catch (err: any) { out.push({ name, ok: false, err: String(err?.message ?? err).slice(0, 300) }); }
    };
    const popup = "(()=>{const b=document.getElementById('app-popup-body');const p=b&&b.closest('[popover],dialog')||b;return {bodyLen:b?b.innerHTML.length:-1,text:b?b.textContent.trim().slice(0,60):null,open:p?(p.matches(':popover-open')||!!p.open):null}})()";
    const msgs = "document.querySelectorAll('#messages > *').length";

    await step("agent-open", async () => { await go("/agent/pcd"); return J(`{v:htmx.version,msgs:${msgs},head:!!document.getElementById('msg-head')}`); });
    await step("load-older", async () => {
        const before = await J(msgs);
        await ev("htmx.trigger(document.getElementById('msg-head'),'load-older')"); await Bun.sleep(2500);
        return { before, after: await J(msgs) };
    });
    await step("popup-toolDetails", async () => { await ev("document.querySelector('[hx-popup=\"agent.toolDetails\"]').click()"); await Bun.sleep(1800); return J(popup); });
    await step("popup-close", async () => { await B.press({ session: S, key: "Escape" }); await Bun.sleep(500); return J(popup); });
    await step("popup-modelPicker", async () => { await ev("document.querySelector('[hx-popup=\"agent.modelPicker\"]').click()"); await Bun.sleep(1800); const s = await J(popup); await B.press({ session: S, key: "Escape" }); return s; });
    await step("palette", async () => { await ev("window.__navOpen()"); await Bun.sleep(1500); const s = await J("{results:document.querySelectorAll('#nav-results a').length}"); await B.press({ session: S, key: "Escape" }); return s; });
    await step("nav-click", async () => {
        await ev("window.__mark=1;window.__navOpen()"); await Bun.sleep(1200);
        await ev("document.querySelector('#nav-results a[href=\"/agent/cajy\"]').click()"); await Bun.sleep(2500);
        return J(`{softNav:window.__mark===1,agent:document.body.dataset.agentId,msgs:${msgs}}`);
    });
    await step("history-back", async () => { await ev("history.back()"); await Bun.sleep(2500); await ev(hook); return J(`{softNav:window.__mark===1,agent:document.body.dataset.agentId,msgs:${msgs}}`); });
    await step("history-forward", async () => { await ev("history.forward()"); await Bun.sleep(2500); await ev(hook); return J(`{softNav:window.__mark===1,agent:document.body.dataset.agentId,msgs:${msgs}}`); });
    await step("meta-toggle", async () => {
        const before = await J("(()=>{const a=document.querySelector('aside[id^=agent-meta]');return a&&getComputedStyle(a).display})()");
        await ev("document.querySelector('[data-action=\"toggle-agent-meta\"]')?.click()"); await Bun.sleep(1200);
        const after = await J("(()=>{const a=document.querySelector('aside[id^=agent-meta]');return a?getComputedStyle(a).display+' '+a.innerText.length:null})()");
        await ev("document.querySelector('[data-action=\"toggle-agent-meta\"]')?.click()");
        return { before, after };
    });
    await step("files", async () => {
        await go("/files?path=src/ui");
        const items = await J("document.querySelectorAll('#main a').length");
        await ev("Array.from(document.querySelectorAll('#main a')).find(a=>/layout\\.ts/.test(a.textContent))?.click()"); await Bun.sleep(2000);
        return { items, after: await J("{url:location.href,code:document.querySelectorAll('#main pre, #main code').length}") };
    });
    await step("news-reader", async () => { await go("/news/reader"); return J("{title:document.title,len:document.getElementById('main')?.innerText.length}"); });
    await step("new-agent-form", async () => {
        await go("/agent/new");
        await B.click({ session: S, target: { css: "#workspace-dir-input" } });
        await B.type({ session: S, target: { css: "#workspace-dir-input" }, text: "/src" }); await Bun.sleep(1500);
        return J("{sugg:document.querySelectorAll('#workspace-dir-suggestions > *').length,status:document.getElementById('workspace-dir-status').innerText.slice(0,60)}");
    });
    if (opts.send) {
        let probe: string | null = null;
        await step("create-agent", async () => {
            await go("/agent/new");
            await ev("document.querySelector('input[name=title]').value='htmx-probe';document.querySelector('select[name=model]').value='claude-code:claude-haiku-4-5';document.getElementById('workspace-dir-input').value='/Users/niquola/hyper-code2';document.querySelector('input[name=title]').form.requestSubmit()");
            await Bun.sleep(3000); await ev(hook);
            const r = await J("{url:location.href,agent:document.body.dataset.agentId}");
            probe = r.agent ?? null;
            // A background tab left by a POST→303 redirect stays in readyState
            // "interactive" and never runs its deferred scripts (Chrome
            // background-tab behaviour, also seen on htmx 2). Open it afresh.
            if (probe) await go("/agent/" + encodeURIComponent(probe));
            return r;
        });
        await step("send-stream", async () => {
            // Reproduce the reported bug: reader scrolled up, then sends.
            await ev("document.getElementById('messages').scrollTop=0");
            // CDP keyboard input into a background tab drops the first keystrokes,
            // so set the value and dispatch the same Enter keydown the composer handles.
            await ev("(()=>{const i=document.getElementById('input');i.focus();i.value='Ответь одним словом: привет. Не используй инструменты.';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})()");
            await Bun.sleep(1500);
            // The composer must clear itself once the POST succeeds.
            const clearedAfterSend = await J("document.querySelector('#form textarea')?.value===''");
            const gapAfterSend = await J("(()=>{const m=document.getElementById('messages');return Math.round(m.scrollHeight-m.scrollTop-m.clientHeight)})()");
            let st: any; let dbReply = false; const t0 = Date.now();
            for (let i = 0; i < 60; i++) {
                await Bun.sleep(1000);
                st = await J(`{n:${msgs},texts:Array.from(document.querySelectorAll('#messages > *')).map(e=>e.innerText.slice(0,40))}`);
                if (!dbReply && probe) dbReply = (await ctx.fns.procs.db.select({ sql: "select 1 from messages where agent_id = ? and role = 'assistant' limit 1", params: [probe] })).length > 0;
                if (st.texts.some((t: string) => /привет/i.test(t) && !/Ответь/.test(t))) break;
            }
            // dbReply=true but no reply on screen = the live update path is broken.
            return { clearedAfterSend, gapAfterSend, dbReply, ...st, ms: Date.now() - t0 };
        });
        // Probe chats are disposable: never leave them in the user's agent list.
        if (probe) await ctx.fns.session.delete({ id: probe });
        delete (ctx.state as any).agent?.[probe ?? ""];
    }
    // Close the tab: it fakes visibility, so it holds an SSE connection, and
    // Chrome allows only 6 HTTP/1.1 connections per origin. Leftover test tabs
    // starved the user's real tabs (scripts never loaded, chat dead).
    await B.closeSessions({ prefix: S }).catch(() => {});
    return out;
}
