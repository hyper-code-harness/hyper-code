/** Handles the new post HTTP route.  * @param opts.req Incoming HTTP request.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request }) {
    const form = await opts.req.formData();
    const values: Record<string, any> = {};
    for (const [name, value] of form) {
        if (values[name] === undefined) values[name] = String(value);
        else if (Array.isArray(values[name])) values[name].push(String(value));
        else values[name] = [values[name], String(value)];
    }
    const result = await ctx.fns.agent.createFromValues(values);
    if (result.error) return new Response(result.error, { status: 400 });
    if (result.confirmation) {
        const esc = (v: any) => ctx.fns.w.escape({ text: v });
        const hidden = Object.entries(result.confirmation.values).flatMap(([name, value]: any) => (Array.isArray(value) ? value : [value]).map(value => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)).join('');
        return { title: 'create workspace', main: `<div class="m-auto max-w-lg p-6"><h1 class="font-semibold">Create workspace directory?</h1><p class="mt-2">Create <code>${esc(result.confirmation.dir)}</code>?</p><form method="POST" action="/agent/new">${hidden}<input type="hidden" name="createWorkspaceDir" value="1">${`<div class="mt-2">${ctx.fns.w.button({ label: 'Create directory and agent', tone: "primary", size: "md", submit: true, marks: { action: 'create-directory-agent' } })}</div>`}</form></div>` };
    }
    return new Response(null, { status: 303, headers: { location: `/agent/${encodeURIComponent(result.agent.id)}` } });
}
