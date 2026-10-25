/** Handles the new get HTTP route.  * @param opts.req Incoming HTTP request.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request }) {
    const fields = await ctx.fns.agent.newForm({ project: new URL(opts.req.url).searchParams.get('project') ?? undefined });
    if (new URL(opts.req.url).searchParams.get('popup')) return new Response(ctx.fns.ui.popupContent({ title: 'New agent', kind: 'new-agent', html: `<form hx-popup="agent.createFromPopup" title="New agent" class="space-y-3" data-form="new-agent">${fields}<div class="flex gap-3">${ctx.fns.w.button({ label: 'create', tone: "primary", size: "md", submit: true, marks: { action: 'create-agent' } })}${`<span class="ml-auto">${ctx.fns.w.button({ label: 'cancel', tone: "ghost", size: "md", marks: { action: 'cancel-new-agent' }, attrs: { onclick: 'window.hyperPopup?.close()' } })}</span>`}</div></form>` }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return { title: 'new agent', main: `<div class="flex-1 overflow-y-auto"><form method="POST" action="/agent/new" hx-boost="false" class="mx-auto max-w-2xl space-y-4 px-6 py-8"><h1 class="text-xl font-semibold">New agent</h1>${fields}<div class="flex gap-3">${ctx.fns.w.button({ label: 'create agent', tone: "primary", size: "md", submit: true, marks: { action: 'create-agent' } })}${ctx.fns.w.button({ label: 'cancel', tone: "ghost", size: "md", action: { href: '/' }, marks: { action: 'cancel-new-agent' } })}</div></form></div>` };
}
