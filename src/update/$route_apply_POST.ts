import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Stages a clean fast-forward update for the launchd supervisor and exits with its dedicated update code. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
    const form=await opts.req.formData();
    if(!await ctx.fns.auth.verifyCsrf({req:opts.req,token:String(form.get("_csrf")??"")})) return new Response("Invalid CSRF token",{status:403});
    const s=await ctx.fns.update.check({fetch:true});
    if(s.state!=="available"||!s.current||!s.target) return new Response(s.message,{status:409});
    const root=String((ctx.state as any).root??process.cwd());
    const changed=await ctx.fns.git.run({args:["diff","--name-only",`${s.current}..${s.target}`],dir:root,host:"local"});
    const files=changed.stdout.split("\n").filter(Boolean);
    if(files.some(file=>/\/(?:\$migration_)[^/]+\.ts$/.test(file))) return new Response("Update contains database migrations; automatic rollback would be unsafe. Apply this release manually.",{status:409});
    const runtime=join(root,".runtime");
    await mkdir(runtime,{recursive:true});
    await writeFile(join(runtime,"update-pending.json"),JSON.stringify({version:1,old:s.current,target:s.target,upstream:s.upstream,requestedAt:Date.now(),lockChanged:files.includes("bun.lock")||files.includes("bun.lockb")})+"\n",{mode:0o600});
    setTimeout(async()=>{try{await ctx.fns.procs.lifecycle.stop({});}finally{process.exit(75);}},100);
    return new Response("Update staged; Hyper is restarting…",{status:202,headers:{"content-type":"text/plain; charset=utf-8"}});
}
