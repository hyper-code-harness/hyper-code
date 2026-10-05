/** Renders self-update status and guarded apply controls. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
    const s=await ctx.fns.update.check({fetch:true});
    const esc=(v:any)=>Bun.escapeHTML(String(v??""));
    const can=s.state==="available";
    let commits="";
    if(can&&s.current&&s.target){
        const root=String((ctx.state as any).root??process.cwd());
        const log=await ctx.fns.git.run({args:["log","--format=%h%x09%s",`${s.current}..${s.target}`,"--max-count=50"],dir:root,host:"local",allowFailure:true});
        const rows=log.ok?log.stdout.trim().split("\n").filter(Boolean):[];
        commits=rows.length?`<section class="mt-5"><h2 class="text-sm font-semibold">What will change</h2><ol class="mt-2 space-y-1">${rows.map(line=>{const [sha,...rest]=line.split("\t");return `<li class="flex gap-3 text-xs"><code class="shrink-0 text-faint">${esc(sha)}</code><span>${esc(rest.join("\t"))}</span></li>`}).join("")}</ol></section>`:"";
    }
    const apply=can?`<form method="post" action="/update/apply"><button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-content">Update and restart</button></form>`:"";
    const main=`<main class="mx-auto max-w-2xl p-6"><h1 class="text-2xl font-semibold">Hyper update</h1><div class="mt-5 rounded-xl border border-ui-border bg-base-100 p-5"><p class="font-medium">${esc(s.message)}</p><dl class="mt-3 grid grid-cols-[8rem_1fr] gap-2 text-xs"><dt>Current</dt><dd class="font-mono">${esc(s.current?.slice(0,12))}</dd><dt>Target</dt><dd class="font-mono">${esc(s.target?.slice(0,12))}</dd><dt>Upstream</dt><dd>${esc(s.upstream)}</dd><dt>Working tree</dt><dd>${s.clean?"clean":"dirty"}</dd></dl><p class="mt-4 text-xs text-subtle">Update requires a completely clean checkout and fast-forward history. Code and dependencies are rolled back if the new server fails its health check. Before releases with migrations, Hyper creates a local PostgreSQL backup; failed startup restores both code and database.</p><div class="mt-4">${apply}</div>${commits}</div></main>`;
    return {title:"Hyper update",main:await ctx.fns.auth.csrfForms({req:opts.req,html:main})};
}
