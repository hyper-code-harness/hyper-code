/** Renders self-update status and guarded apply controls. */
export default async function(ctx:Context,_session:Session|null,opts:{req:Request;params:Record<string,string>}) {
    const s=await ctx.fns.update.check({fetch:true});
    const esc=(v:any)=>Bun.escapeHTML(String(v??""));
    const supervised=!!ctx.env.HYPER_UPDATE_SUPERVISOR;
    const can=s.state==="available"&&supervised;
    let commits="";
    if(s.state==="available"&&s.current&&s.target){
        const root=String((ctx.state as any).root??process.cwd());
        const log=await ctx.fns.git.run({args:["log","--format=%h%x09%s",`${s.current}..${s.target}`,"--max-count=50"],dir:root,host:"local",allowFailure:true});
        const rows=log.ok?log.stdout.trim().split("\n").filter(Boolean):[];
        commits=rows.length?`<section class="mt-5"><h2 class="text-sm font-semibold">What will change</h2><ol class="mt-2 space-y-1">${rows.map(line=>{const [sha,...rest]=line.split("\t");return `<li class="flex gap-3 text-xs"><code class="shrink-0 text-faint">${esc(sha)}</code><span>${esc(rest.join("\t"))}</span></li>`}).join("")}</ol></section>`:"";
    }
    // Plugins that live in the Hyper tree now and not in the target: after the update they are not mounted until they are
    // installed from the catalog. 2026-11-15 a fleet update silently took telegram, mermaid and four more away this way.
    let dropped="";
    if(s.state==="available"&&s.current&&s.target){
        const d=await Promise.resolve().then(()=>ctx.fns.plugins.dropped({from:s.current!,to:s.target!})).catch(()=>null);
        const used=d?.plugins.filter(p=>p.mounted&&!p.installed)??[];
        if(used.length) dropped=`<section class="mt-5 rounded-md border border-warning/40 bg-warning/10 p-3" data-dropped-plugins><h2 class="text-sm font-semibold">Plugins this update removes from Hyper</h2><p class="mt-1 text-xs">These ship inside Hyper today and are in use here. The new version no longer includes them: after the update their functions, pages and Markdown blocks are gone until you install them from the <a class="underline" href="/plugins/listing">plugin catalog</a>.</p><ul class="mt-2 space-y-1 text-xs">${used.map(p=>`<li><code>${esc(p.name)}</code> — ${esc(p.label)}${p.latest?` · in the catalog as ${esc(p.latest)}`:" · not in the catalog of this instance"}</li>`).join("")}</ul></section>`;
    }
    const apply=can?`<form method="post" action="/update/apply"><button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-content">Update and restart</button></form>`:s.state==="available"?`<p class="text-sm text-warning">Update available, but this Hyper is not started through <code>script/run-service.ts</code>, so it cannot update itself. Ask the administrator.</p>`:"";
    const main=`<main class="mx-auto max-w-2xl p-6"><h1 class="text-2xl font-semibold">Hyper update</h1><div class="mt-5 rounded-xl border border-ui-border bg-base-100 p-5"><p class="font-medium">${esc(s.message)}</p><dl class="mt-3 grid grid-cols-[8rem_1fr] gap-2 text-xs"><dt>Current</dt><dd class="font-mono">${esc(s.current?.slice(0,12))}</dd><dt>Target</dt><dd class="font-mono">${esc(s.target?.slice(0,12))}</dd><dt>Upstream</dt><dd>${esc(s.upstream)}</dd><dt>Working tree</dt><dd>${s.clean?"clean":"dirty"}</dd></dl><p class="mt-4 text-xs text-subtle">Update requires a completely clean checkout and fast-forward history. Code and dependencies are rolled back if the new server fails its health check. Before releases with migrations, Hyper creates a local PostgreSQL backup; failed startup restores both code and database.</p>${dropped}<div class="mt-4">${apply}</div>${commits}</div></main>`;
    return {title:"Hyper update",main:await ctx.fns.auth.csrfForms({req:opts.req,html:main})};
}
