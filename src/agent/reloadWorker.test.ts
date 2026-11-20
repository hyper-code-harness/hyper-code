import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("worker reload waits for old work, shares one handoff and never aborts agents",async()=>{
    const ctx:any=await mkTestCtx();
    const prior=Promise.withResolvers<void>();let starts=0;let wakes=0;let aborts=0;
    ctx.state.workerLoopRunning=true;ctx.state.workerLoopPromise=prior.promise;
    ctx.state.agent={test:{abortController:{abort(){aborts++;}}}};
    ctx.state.registry.agent.wakeWorker=()=>{wakes++;};
    ctx.state.registry.agent.workerLoop=()=>{starts++;ctx.state.workerLoopRunning=true;ctx.state.compactionQueueWorker=true;return Promise.resolve();};
    const one=ctx.fns.agent.reloadWorker({});const two=ctx.fns.agent.reloadWorker({});
    expect(ctx.state.workerLoopRunning).toBe(false);expect(starts).toBe(0);expect(wakes).toBe(1);expect(aborts).toBe(0);
    prior.resolve();expect(await one).toEqual({reloaded:true});expect(await two).toEqual({reloaded:true});
    expect(starts).toBe(1);expect(aborts).toBe(0);expect(ctx.state.compactionQueueWorker).toBe(true);
});

test("an untracked running worker is not replaced",async()=>{
    const ctx:any=await mkTestCtx();ctx.state.workerLoopRunning=true;
    await expect(ctx.fns.agent.reloadWorker({})).rejects.toThrow("untracked worker");
    expect(ctx.state.workerLoopRunning).toBe(true);
});
