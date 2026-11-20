import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const deferred = () => Promise.withResolvers<void>();
async function setup(long = true) {
    const ctx: any = await mkTestCtx();
    ctx.state.registry.agent.autoCompactIfNeeded = async () => ({ status: "below_threshold" });
    const agent = await ctx.fns.agent.start({ model: "lmstudio:test" });
    if (long) for (let i = 0; i < 12; i++) await ctx.fns.session.appendMessage({ id:agent.id, message:{role:i%2 ? "assistant":"user",content:`${i}:`+"x".repeat(16000)} });
    await ctx.fns.session.syncAgentState({agent});
    ctx.state.registry.llm.call = async () => ({text:"handoff",finishReason:"stop",usage:{},raw:{}});
    return {ctx,agent};
}
async function row(ctx:any,id:string) { return (await ctx.fns.procs.db.select({sql:"SELECT model,run_state,run_token,next_run_at,last_processed_msg_idx,sleep_context FROM agents WHERE id=?",params:[id]}))[0]; }
async function stop(ctx:any,loop:Promise<void>) { ctx.state.workerLoopRunning=false;ctx.fns.agent.wakeWorker({});await loop; }
async function waitFor(fn:()=>Promise<boolean>) { const until=Date.now()+8000;while(!await fn()){ if(Date.now()>until)throw new Error("condition not reached");await Bun.sleep(10); } }

describe("queued context compaction",()=>{
    test("enqueue while running preserves instructions, cursor and schedule; duplicate requests coalesce",async()=>{
        const {ctx,agent}=await setup(false);
        await ctx.fns.procs.db.run({sql:"UPDATE agents SET run_state='running',run_token='turn',next_run_at=123,last_processed_msg_idx=7 WHERE id=?",params:[agent.id]});
        const before=await row(ctx,agent.id);
        const one=await ctx.fns.agent.requestCompaction({agentId:agent.id,instructions:"keep decisions"});
        const two=await ctx.fns.agent.requestCompaction({agentId:agent.id,instructions:"keep paths"});
        expect(two).toMatchObject({jobId:one.jobId,reused:true,status:"queued"});
        expect((await ctx.fns.jobs.get({id:one.jobId})).spec.instructions).toBe("keep paths");
        expect(await row(ctx,agent.id)).toEqual(before);
        expect(await ctx.fns.agent.claimCompaction({now:Date.now()})).toBeNull();
        expect((await ctx.fns.jobs.poll({})).checked).not.toContain(one.jobId);
        expect((await ctx.fns.jobs.get({id:one.jobId})).status).toBe("running");
    });

    test("idle queue compacts without a conversation turn and forwards textarea focus",async()=>{
        const {ctx,agent}=await setup();
        let calls=0;let system="";
        ctx.state.registry.llm.call=async (_c:any,_s:any,o:any)=>{system=o.system;return {text:"handoff",finishReason:"stop",usage:{},raw:{}};};
        ctx.state.registry.agent.run=async()=>{calls++;};
        const before=await row(ctx,agent.id);
        const messages=await ctx.fns.session.getMessages({id:agent.id});
        const job=await ctx.fns.agent.requestCompaction({agentId:agent.id,instructions:"Keep exact file paths"});
        const loop=ctx.fns.agent.workerLoop({});
        try {await waitFor(async()=>(await ctx.fns.jobs.get({id:job.jobId})).status!=="running");}finally{await stop(ctx,loop);}
        expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("succeeded");
        expect(system).toContain("Focus instructions: Keep exact file paths");
        expect(calls).toBe(0);
        expect(await ctx.fns.session.getMessages({id:agent.id})).toEqual(messages);
        expect(await row(ctx,agent.id)).toMatchObject({run_state:"idle",next_run_at:before.next_run_at,last_processed_msg_idx:before.last_processed_msg_idx});
        expect((await row(ctx,agent.id)).sleep_context.activeRevision).toBe(1);
    });

    test("waits for the full running turn, does not abort, and precedes the next queued turn",async()=>{
        const {ctx,agent}=await setup();
        const started=deferred(), release=deferred(), compacted=deferred();const order:string[]=[];
        let runs=0;let aborted=false;
        ctx.state.registry.agent.run=async(_c:any,_s:any,o:any)=>{
            runs++;order.push("run"+runs);
            if(runs===1){o.agent.abortController=new AbortController();o.agent.abortController.signal.addEventListener("abort",()=>{aborted=true;});started.resolve();await release.promise;}
        };
        ctx.state.registry.llm.call=async()=>{order.push("compact");compacted.resolve();return {text:"handoff",finishReason:"stop",usage:{},raw:{}};};
        await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=? WHERE id=?",params:[Date.now(),agent.id]});
        const loop=ctx.fns.agent.workerLoop({});
        try {
            await started.promise;
            const job=await ctx.fns.agent.requestCompaction({agentId:agent.id,instructions:"focus"});
            await ctx.fns.session.appendUserMessage({id:agent.id,text:"next question"});
            await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=? WHERE id=?",params:[Date.now(),agent.id]});
            expect(order).toEqual(["run1"]);expect(aborted).toBe(false);
            release.resolve();await compacted.promise;
            await waitFor(async()=>runs===2 && (await row(ctx,agent.id)).run_state==="idle");
            expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("succeeded");
            expect(order).toEqual(["run1","compact","run2"]);expect(aborted).toBe(false);
        }finally{release.resolve();await stop(ctx,loop);}
    });

    test("a queued request fences normal claims; only one compaction can own the agent",async()=>{
        const {ctx,agent}=await setup();
        await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=? WHERE id=?",params:[Date.now(),agent.id]});
        const job=await ctx.fns.agent.requestCompaction({agentId:agent.id});
        expect(await ctx.fns.agent.claimPendingTurn({now:Date.now()})).toBeNull();
        const claim=await ctx.fns.agent.claimCompaction({now:Date.now()});expect(claim.jobId).toBe(job.jobId);
        const followup=await ctx.fns.agent.requestCompaction({agentId:agent.id,instructions:"second"});expect(followup.jobId).not.toBe(job.jobId);
        expect(await ctx.fns.agent.claimCompaction({now:Date.now()})).toBeNull();
        await ctx.fns.agent.runQueuedCompaction(claim);
        const next=await ctx.fns.agent.claimCompaction({now:Date.now()});expect(next.jobId).toBe(followup.jobId);
        await ctx.fns.agent.runQueuedCompaction(next);
        expect(await ctx.fns.agent.claimPendingTurn({now:Date.now()})).not.toBeNull();
    });

    test("cancellation during summary prevents activation, completion and any user message",async()=>{
        const {ctx,agent}=await setup();const entered=deferred(),release=deferred();
        ctx.state.registry.llm.call=async()=>{entered.resolve();await release.promise;return {text:"handoff",finishReason:"stop",usage:{},raw:{}};};
        const before=await ctx.fns.session.getMessages({id:agent.id});
        const request=await ctx.fns.agent.requestCompaction({agentId:agent.id});const claim=await ctx.fns.agent.claimCompaction({now:Date.now()});
        const work=ctx.fns.agent.runQueuedCompaction(claim);await entered.promise;
        await ctx.fns.jobs.cancel({id:request.jobId});release.resolve();await work;
        await ctx.fns.agent.recoverOrphanedCompactions({});
        expect((await ctx.fns.jobs.get({id:request.jobId})).status).toBe("cancelled");
        expect((await row(ctx,agent.id)).sleep_context.activeRevision).toBeNull();
        expect((await row(ctx,agent.id)).sleep_context.draftRevision).toBeNull();
        expect(await ctx.fns.session.getMessages({id:agent.id})).toEqual(before);
    });

    test("expired same-process lease is recovered and an old attempt cannot clear its replacement",async()=>{
        const {ctx,agent}=await setup();const entered=deferred(),release=deferred();let calls=0;
        ctx.state.registry.llm.call=async()=>{if(++calls===1){entered.resolve();await release.promise;}return {text:"handoff"+calls,finishReason:"stop",usage:{},raw:{}};};
        const request=await ctx.fns.agent.requestCompaction({agentId:agent.id});const first=await ctx.fns.agent.claimCompaction({now:Date.now()});
        const old=ctx.fns.agent.runQueuedCompaction(first);await entered.promise;
        await ctx.fns.procs.db.run({sql:"UPDATE jobs SET lease_expires_at=0,next_at=0 WHERE id=?",params:[request.jobId]});
        expect((await ctx.fns.agent.recoverOrphanedCompactions({})).recovered).toContain(agent.id);
        const second=await ctx.fns.agent.claimCompaction({now:Date.now()});expect(second.token).not.toBe(first.token);
        await ctx.fns.agent.runQueuedCompaction(second);
        const head=(await row(ctx,agent.id)).sleep_context.activeRevision;
        release.resolve();await old;
        expect((await row(ctx,agent.id)).sleep_context.activeRevision).toBe(head);
        expect(agent.sleepContext.activeRevision).toBe(head);
        expect((await ctx.fns.jobs.get({id:request.jobId})).status).toBe("succeeded");
    });

    test("empty history finishes not_needed and summarizer failure releases the queue without waking",async()=>{
        for(const long of [false,true]){
            const {ctx,agent}=await setup(long);
            ctx.state.registry.llm.call=async()=>{throw new Error("summary failed");};
            const job=await ctx.fns.agent.requestCompaction({agentId:agent.id});
            await ctx.fns.agent.runQueuedCompaction(await ctx.fns.agent.claimCompaction({now:Date.now()}));
            expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe(long?"failed":"succeeded");
            expect((await row(ctx,agent.id)).next_run_at).toBeNull();
            expect((await row(ctx,agent.id)).sleep_context?.draftRevision??null).toBeNull();
        }
    });
    test("Codex native compaction also receives optional focus instructions",async()=>{
        const {ctx,agent}=await setup();agent.model="codex:gpt-test";await ctx.fns.session.save({agent});
        let instructions="";
        ctx.state.registry.llm.compactCodex=async(_c:any,_s:any,o:any)=>{instructions=o.instructions;return {item:{type:"compaction",encrypted_content:"opaque"},responseId:"r",usage:{}};};
        const job=await ctx.fns.agent.requestCompaction({agentId:agent.id,instructions:"Preserve paths and decisions"});
        await ctx.fns.agent.runQueuedCompaction(await ctx.fns.agent.claimCompaction({now:Date.now()}));
        expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("succeeded");
        expect(instructions).toContain("Compaction focus instructions: Preserve paths and decisions");
    });

    test("same-count edits during summary leave the request queued instead of activating stale context",async()=>{
        const {ctx,agent}=await setup();
        ctx.state.registry.llm.call=async()=>{await ctx.fns.session.updateMessageContent({id:agent.id,idx:0,content:"changed decision"});return {text:"old handoff",usage:{},raw:{}};};
        const job=await ctx.fns.agent.requestCompaction({agentId:agent.id});
        await ctx.fns.agent.runQueuedCompaction(await ctx.fns.agent.claimCompaction({now:Date.now()}));
        expect((await row(ctx,agent.id)).sleep_context.activeRevision).toBeNull();
        expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("running");
        expect((await row(ctx,agent.id)).next_run_at).toBeNull();
    });

    test("interrupted cancellation and exhausted lease retries unblock normal work",async()=>{
        const {ctx,agent}=await setup(false);
        let job=await ctx.fns.agent.requestCompaction({agentId:agent.id});
        await ctx.fns.procs.db.run({sql:"UPDATE jobs SET cancel_requested_at=? WHERE id=?",params:[Date.now(),job.jobId]});
        expect(await ctx.fns.agent.claimCompaction({now:Date.now()})).toBeNull();
        expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("cancelled");
        job=await ctx.fns.agent.requestCompaction({agentId:agent.id});
        await ctx.fns.procs.db.run({sql:"UPDATE jobs SET state='{\"attempts\":3}'::jsonb WHERE id=?",params:[job.jobId]});
        expect(await ctx.fns.agent.claimCompaction({now:Date.now()})).toBeNull();
        expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("failed");
        await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=? WHERE id=?",params:[Date.now(),agent.id]});
        expect(await ctx.fns.agent.claimPendingTurn({now:Date.now()})).not.toBeNull();
    });

    test("another agent and schedules progress while the summarizer is waiting",async()=>{
        const {ctx,agent}=await setup();const entered=deferred(),release=deferred();let otherRan=false;
        const other=await ctx.fns.agent.start({model:"mock:other"});
        ctx.state.registry.llm.call=async()=>{entered.resolve();await release.promise;return {text:"handoff",usage:{},raw:{}};};
        ctx.state.registry.agent.run=async(_c:any,_s:any,o:any)=>{if(o.agent.id===other.id)otherRan=true;};
        const job=await ctx.fns.agent.requestCompaction({agentId:agent.id});
        const loop=ctx.fns.agent.workerLoop({});
        try{
            await entered.promise;
            await ctx.fns.agent.wake({id:other.id,inMs:1000,prompt:"hello"});
            await waitFor(async()=>otherRan);
            expect((await ctx.fns.jobs.get({id:job.jobId})).status).toBe("running");
        }finally{release.resolve();await stop(ctx,loop);}
    });

});
