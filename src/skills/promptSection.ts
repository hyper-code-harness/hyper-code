/**
 * Builds the system-prompt section that tells an agent what plugins and skills are, how to find them and how they get installed
 *
 * Use from agent.fullSystemPrompt. Empty for an agent without the `skill` tool, so nothing changes for agents that
 * cannot load a skill. The text is the same for every agent and every session — it names no skill and no pack, so
 * installing or removing skills never moves the cached prompt prefix. It sets the order of looking before a task:
 * a plugin first, then an installed skill, then the public collections, and says that installing a skill pack is
 * the person's decision (skills.propose).
 * @param opts.agent Agent the prompt is built for.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent the prompt is built for. */
    agent: types.agent.Agent;
}): string {
    if (!ctx.fns.skills.enabledFor({ agent: opts.agent })) return "";
    return [
        "## Finding ready-made help: plugins first, then skills",
        "",
        "Before a task that is more than a quick answer, check what already exists. Go down the three steps below until one gives what the task needs, all in the same turn: never end a turn by saying what you will look for next.",
        "- A plugin is code: functions called as ctx.fns.<namespace>.<function>, for doing something with data, a file or a service. Mounted plugins are listed above.",
        "- A skill is a procedure: written instructions for doing one kind of work well (a review method, a test-first workflow, a document recipe), sometimes with scripts. Skills are installed on this system, but none is listed here: you search for them.",
        "",
        "`skill` is a tool you call directly; it is not a ctx.fns function. Everything written ctx.fns.… below runs inside eval, where a result shows only when you print it: console.log(JSON.stringify(await ctx.fns.plugins.search({ query }))). Queries in English.",
        "1. Mounted plugins — ctx.fns.plugins.search({ query }) → [{ plugin, description, functions: [{ name, summary, signature }] }]. It always returns the nearest plugins; one fits only when its description says it does this job. One fits: use it (ctx.fns.plugins.read({ name }) shows how) and skip steps 2 and 3.",
        "2. Installed skills — skill({ query }) → the skills you can load, then the ones only the person can start; skill({ name }) loads one of the first kind, and you follow its <skill_content>. Use it when no plugin fits, when the question is how to do a kind of work, or when the person names a skill. A result marked \"the person starts it with /name\", or a load that is refused, means you may not use that skill yourself: tell the person it exists and that they start it by typing /name, and say about it only what its one-line description says. Do not read its files another way.",
        "3. Nothing installed fits — look outside: ctx.fns.skills.hubSearch({ query }) → { skills: [{ repo, skill, installs, trust, installed }], collections } searches public skill collections (prefer trust \"official\", then curated: true — the publisher's own repository — over a bigger install count); ctx.fns.plugins.catalog({ q }) lists installable plugins. ctx.fns.skills.preview({ repo, select }) shows what a pack contains (optional).",
        "",
        "Installing. A plugin: ctx.fns.plugins.install({ name }) — a preview first. A skill: you cannot install it, and proposing it is how you get it set up — ctx.fns.skills.propose({ repo, select: [\"skill-name\"], why }) opens a form in the person's chat and installs nothing (omit select to offer everything the repository lists). Then say what you proposed and why, and end the turn: their answer arrives as a new message, and only then is the skill available.",
        "When the person types /name, that skill is already in the conversation: follow it, do not load it again.",
    ].join("\n");
}
