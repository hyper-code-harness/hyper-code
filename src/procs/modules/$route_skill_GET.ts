// GET /procs/modules/skill?name=<module> — the module's SKILL.md, read.
//
// A `SKILL.md` is written for the agent, and until now that is the only thing
// that ever opened one: the panel said a module *has* a skill and gave no way to
// see it, so the person deciding whether to turn a module on knew less about it
// than the agent did. It is the same page for both.
//
// Markdown is rendered by the host's canonical markdown.render helper, shared
// with chat messages, file previews, and plugin pages.
/**
 * Handle the GET request for the modules route.
 * @param opts.req The incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const esc = (s: any) => ctx.fns.w.escape({ text: s });
    const name = new URL(opts.req.url).searchParams.get("name") ?? "";
    const module = (ctx.state.procs.modules ?? []).find((m: any) => m.name === name || m.namespaces?.includes(name));

    if (!module?.skill) {
        return {
            title: "skill",
            status: 404,
            main: ctx.fns.w.toast({ level: "warning", message: `${name || "that module"} ships no SKILL.md` }),
        };
    }

    const text = await Bun.file(module.skill).text().catch(() => null);
    if (text === null) {
        return { title: "skill", status: 404, main: ctx.fns.w.toast({ level: "error", message: `${module.skill} is named by the module and is not on disk` }) };
    }

    const body = await ctx.fns.markdown.render({ source: text });

    return {
        title: `${module.name} · skill`,
        main: ctx.fns.w.page({
            page: "skill",
            title: module.label ?? module.name,
            lead: `<span class="wx-mono">${esc(module.skill)}</span> — what the agent reads before it touches this module.`,
            body: ctx.fns.w.card({ title: "SKILL.md", icon: "file-text", body: `<div class="md-preview prose prose-sm max-w-none">${body}</div>` }),
        }),
    };
}
