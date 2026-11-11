// POST /modules/add — declare a module in workspace.json and mount it. A name
// that resolves to nothing: the reason comes back on
// the page rather than as a 500, so the pane keeps whatever was typed.
/**
 * Handle the POST request for the modules route.
 * @param opts.req The incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session, opts: { req: Request }) {
    const form = await opts.req.formData();
    const name = String(form.get("name") ?? "").trim();
    try {
        const added = await ctx.fns.procs.modules.add({ name });
        return { title: "modules", main: await ctx.fns.procs.modules.panel({ message: `Mounted ${added.name} — ${added.fns.length} fns${added.tab ? ", one tab" : ""}${added.skill ? ", a skill" : ""}` }) };
    } catch (error: any) {
        return { title: "modules", main: await ctx.fns.procs.modules.panel({ error: String(error?.message ?? error) }) };
    }
}
