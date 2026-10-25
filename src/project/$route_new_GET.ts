/** Shows the new-project form.
 * @param opts.req Incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
}) {
    const fields = await ctx.fns.project.newForm({});
    return { title: "new project", main: `<div class="flex-1 overflow-y-auto"><form method="POST" action="/project/new" hx-boost="false" class="mx-auto max-w-2xl space-y-4 px-6 py-8" data-form="new-project"><h1 class="text-xl font-semibold">New project</h1>${fields}<div class="flex gap-3">${ctx.fns.w.button({ label: "create project", size: "sm", tone: "primary", submit: true, marks: { action: "create-project" } })}${ctx.fns.w.button({ label: "cancel", size: "sm", tone: "ghost", action: { href: "/" }, marks: { action: "cancel-new-project" } })}</div></form></div>` };
}
