import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Stages a clean fast-forward update for the launchd supervisor and exits with its dedicated update code. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
    const form=await opts.req.formData();
    if(!await ctx.fns.auth.verifyCsrf({req:opts.req,token:String(form.get("_csrf")??"")})) return new Response("Invalid CSRF token",{status:403});
    // Only script/run-service.ts applies a staged update (it sets HYPER_UPDATE_SUPERVISOR for its child). Without it the
    // exit below just stops Hyper and a plain supervisor (hyperd running src/$main.ts) restarts the OLD code: 2026-11-12
    // the crm instance went down this way. Refuse instead of exiting.
    if(!ctx.env.HYPER_UPDATE_SUPERVISOR) return new Response("Self-update is not available: this Hyper is not run by script/run-service.ts, so nothing would apply the update. Run the unit with cmd script/run-service.ts (see docs/hyperd.md).",{status:409,headers:{"content-type":"text/plain; charset=utf-8"}});
    const s=await ctx.fns.update.check({fetch:true});
    if(s.state!=="available"||!s.current||!s.target) return new Response(s.message,{status:409});
    const root=String((ctx.state as any).root??process.cwd());
    const changed=await ctx.fns.git.run({args:["diff","--name-only",`${s.current}..${s.target}`],dir:root,host:"local"});
    const files=changed.stdout.split("\n").filter(Boolean);
    const migrationsChanged=files.some(file=>/(?:^|\/)\$migration_[^/]+\.ts$/.test(file));
    const runtime=join(root,".runtime");
    await mkdir(runtime,{recursive:true});
    await writeFile(join(runtime,"update-pending.json"),JSON.stringify({version:1,old:s.current,target:s.target,upstream:s.upstream,requestedAt:Date.now(),lockChanged:files.includes("bun.lock")||files.includes("bun.lockb"),migrationsChanged})+"\n",{mode:0o600});
    // The exit must happen whatever the $stop hooks do: 2026-11-14 crm stopped its HTTP listener, then a $stop hook
    // never returned (h2 waits for server.close() while connections stay open) — the process lived on without a
    // listener, the supervisor kept waiting for it to exit, and the instance answered 502 until someone killed it.
    // Same rule as the signal handler in $main.ts: ten seconds, then exit anyway.
    setTimeout(()=>{
        setTimeout(()=>{console.error("[update] shutdown did not finish in 10s — forcing exit");process.exit(75);},10_000);
        ctx.fns.procs.lifecycle.stop({}).catch((error:unknown)=>console.error("[update] shutdown failed:",error)).finally(()=>process.exit(75));
    },100);
    return new Response("Update staged; Hyper is restarting…",{status:202,headers:{"content-type":"text/plain; charset=utf-8"}});
}
