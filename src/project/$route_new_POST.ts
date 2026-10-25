/** Creates a project from the new-project form (a missing folder is created), then opens the new-agent form inside it; on an error shows the form again with the message.
 * @param opts.req Incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
}) {
    const form = await opts.req.formData();
    const values = { title: String(form.get("title") ?? "").trim(), slug: String(form.get("slug") ?? "").trim(), defaultDir: String(form.get("defaultDir") ?? "").trim() };
    try {
        if (!values.title) throw new Error("Title is required");
        const project = await ctx.fns.project.create({ title: values.title.slice(0, 120), slug: values.slug, defaultDir: values.defaultDir, createDir: true });
        ctx.fns.events.emitAgentsChanged({ reason: "project" });
        return new Response(null, { status: 303, headers: { location: `/agent/new?project=${encodeURIComponent(project.id)}` } });
    } catch (error: any) {
        const message = String(error?.message ?? error).replace(/^project\.create: /, "");
        const fields = await ctx.fns.project.newForm({ values, error: message });
        return { title: "new project", main: `<div class="flex-1 overflow-y-auto"><form method="POST" action="/project/new" hx-boost="false" class="mx-auto max-w-2xl space-y-4 px-6 py-8" data-form="new-project"><h1 class="text-xl font-semibold">New project</h1>${fields}<div class="flex gap-3">${ctx.fns.w.button({ label: "create project", size: "sm", tone: "primary", submit: true, marks: { action: "create-project" } })}${ctx.fns.w.button({ label: "cancel", size: "sm", tone: "ghost", action: { href: "/" }, marks: { action: "cancel-new-project" } })}</div></form></div>` };
    }
}
