/**
 * Shows what a skills repository contains before anything is installed: its skills, scripts and warnings
 *
 * Use to look inside a collection — from the Skills page, or `canvas.show({ args: { fn: "skills.previewPage", params:
 * { repo: "github:anthropics/skills" } } })`. Fetches the repository into a read-only preview (skills.preview, cached)
 * and lists every skill with its description, who may start it, size, executable files and parser warnings; a skill
 * name opens the file viewer on the previewed copy (skills.view). Says which of the skills are already installed and
 * which are not. Installs nothing: an agent proposes an install with skills.propose and the person decides in the
 * chat form.
 * @view
 * @live skills
 * @param opts.repo Repository: `github:owner/repo`, an https or ssh address.
 * @param opts.ref Tag, branch or commit instead of the newest release.
 * @param opts.select Skill names, folder globs or marketplace set names to keep.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository: `github:owner/repo`, an https or ssh address. */
    repo: string;
    /** Tag, branch or commit instead of the newest release. */
    ref?: string;
    /** Skill names, folder globs or marketplace set names to keep. */
    select?: string[];
}): Promise<string> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const small = (html: string) => w.box({ body: html, mix: { text: "small", ink: "faint" } });
    const url = (fn: string, params: Record<string, unknown>) => esc(ctx.fns.rpc.url({ fn, params }));
    let p: types.skills.PackPreview;
    try { p = await ctx.fns.skills.preview({ repo: String(opts.repo ?? ""), ...(opts.ref ? { ref: String(opts.ref) } : {}), ...(Array.isArray(opts.select) && opts.select.length ? { select: opts.select.map(String) } : {}) }); }
    catch (error: any) { return w.empty({ title: "This repository cannot be previewed", hint: String(error?.message ?? error).slice(0, 300), icon: "warning-circle", tone: "danger" }); }
    const scripts = p.skills.reduce((n, s) => n + s.executables.length, 0);
    const facts = [
        `<a class="w-link" href="${url("skills.page", {})}">skills</a>`,
        `${esc(p.repo)} @ ${esc(p.tag ?? p.branch ?? "commit")} (${esc(p.commit.slice(0, 10))})`,
        `trust: ${esc(p.trust)}`,
        `${p.skills.length} skills, ${scripts} scripts`,
    ].join(" · ");
    const have = p.skills.filter(s => s.change === "same").length;
    const changed = p.skills.filter(s => s.change === "changed").length;
    const state = p.installedAs
        ? esc(`Pack "${p.installedAs}" has ${have + changed} of these ${p.skills.length} skills installed${changed ? `, ${changed} of them changed upstream` : ""}.`)
        : esc(`Nothing from here is installed. It would become pack "${p.pack}". Open a skill to read all of its files first.`);
    const packActions = await ctx.fns.skills.actions({ repo: p.repo, ...(p.ref ? { ref: p.ref } : {}) });
    const skillActions: Record<string, string> = {};
    for (const s of p.skills) skillActions[s.name] = await ctx.fns.skills.actions({ repo: p.repo, skill: s.name, installed: Boolean(p.installedAs) && s.change !== "added", ...(p.ref ? { ref: p.ref } : {}) });
    const mark = (s: types.skills.PackPreview["skills"][number]) => !p.installedAs ? "" : s.change === "same" ? w.badge({ text: "installed", tone: "success" }) : s.change === "changed" ? w.badge({ text: "changed upstream", tone: "warning" }) : w.badge({ text: "not installed", tone: "neutral" });
    const list = p.skills.map(s => ctx.fns.skills.item({
        title: `<a class="w-link" href="${url("skills.view", { name: s.name, preview: p.id })}">${esc(s.name)}</a>` + mark(s)
            + (s.byModel ? "" : w.badge({ text: "/" + s.name + " only", tone: "neutral" })),
        text: esc(s.description),
        meta: [
            esc(`${s.bodyChars} chars · ${s.files} files`),
            s.executables.length ? `${s.executables.length} script${s.executables.length > 1 ? "s" : ""}: ` + s.executables.slice(0, 12).map(file => `<a class="w-link" href="${url("skills.view", { name: s.name, preview: p.id, file })}">${esc(file)}</a>`).join(", ") + (s.executables.length > 12 ? ` and ${s.executables.length - 12} more` : "") : "",
            s.diagnostics.length ? "⚠ " + esc(s.diagnostics.join("; ").slice(0, 300)) : "",
        ].filter(Boolean).join("<br>") + (skillActions[s.name] ?? ""),
    })).join("");
    const skipped = p.skipped.length ? small("Skipped: " + p.skipped.map(s => `${esc(s.path)} — ${esc(s.reason)}`).join("; ")) : "";
    return w.box({ body: w.heading({ title: p.repo.replace(/^github:/, ""), meta: small(facts) }) + w.box({ body: state, mix: { text: "small" } }) + packActions + `<div>${list}</div>` + skipped, mix: { layout: "stack", gap: "s3" } });
}
