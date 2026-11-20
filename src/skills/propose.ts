/**
 * Proposes installing a skill pack to the person: opens a form in the chat with what would be installed, and returns at once
 *
 * Use after skills.hubSearch found something worth having, or when the person asks for a skill that is not
 * installed. Fetches a preview (skills.preview) and opens a chat form listing the skills, their scripts and the
 * trust level, with links to read every file first (skills.view). The person installs or declines there — an agent
 * cannot confirm an install itself. On Install the pack is installed at the previewed content and the agent is woken
 * with the result; end the turn after calling. Say in `why` what the skills are for in the person's own task.
 * @param opts.repo Repository: `github:owner/repo`, an https or ssh address.
 * @param opts.select Skill names, folder globs or marketplace set names to propose instead of everything the repository lists.
 * @param opts.ref Tag, branch or commit instead of the newest release.
 * @param opts.as Pack name to install under.
 * @param opts.why One or two sentences for the person: why these skills, for which task.
 * @param opts.agentId Agent whose chat gets the form. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Repository: `github:owner/repo`, an https or ssh address. */
    repo: string;
    /** Skill names, folder globs or marketplace set names to propose instead of everything the repository lists. */
    select?: string[];
    /** Tag, branch or commit instead of the newest release. */
    ref?: string;
    /** Pack name to install under. */
    as?: string;
    /** One or two sentences for the person: why these skills, for which task. */
    why?: string;
    /** Agent whose chat gets the form. @default the current agent */
    agentId?: string;
}): Promise<{ inputId: string; preview: string; pack: string; repo: string; commit: string; skills: string[]; scripts: number; trust: string }> {
    const preview = await ctx.fns.skills.preview({ repo: opts.repo, ...(opts.ref ? { ref: opts.ref } : {}), ...(opts.select?.length ? { select: opts.select } : {}), ...(opts.as ? { as: opts.as } : {}) });
    const fresh = preview.skills.filter(s => s.change !== "same");
    if (!fresh.length) throw new Error(`Everything in this selection is already installed as pack ${preview.installedAs}`);
    const input = await ctx.fns.input.request({
        kind: "skillinstall",
        title: `Install ${preview.skills.length} skill${preview.skills.length > 1 ? "s" : ""} from ${preview.repo.replace(/^github:/, "")}?`,
        message: String(opts.why ?? "").slice(0, 1000),
        spec: { preview: preview.id },
        ...(opts.agentId ? { agentId: opts.agentId } : {}),
    });
    return {
        inputId: input.id, preview: preview.id, pack: preview.pack, repo: preview.repo, commit: preview.commit, skills: preview.skills.map(s => s.name),
        scripts: preview.skills.reduce((n, s) => n + s.executables.length, 0), trust: preview.trust,
    };
}
