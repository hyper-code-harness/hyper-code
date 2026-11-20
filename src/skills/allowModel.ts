/**
 * Allows or forbids the model to start skills of one installed pack by itself
 *
 * Use after a person has looked at a community pack and wants agents to pick its skills on their own, or to take that
 * back. A forbidden pack stays installed: a person still starts its skills with /name. Changes the pack's `model`
 * flag in the skills lock and refreshes the index, so the next skill list an agent gets reflects it.
 * @param opts.name Installed pack name.
 * @param opts.allow True lets the model start the pack's skills; false leaves /name only.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed pack name. */
    name: string;
    /** True lets the model start the pack's skills; false leaves /name only. */
    allow: boolean;
}): Promise<{ pack: string; model: boolean; skills: number }> {
    if (opts.allow === true) ctx.fns.skills.personOnly({ what: "allow a skill pack to the model" });
    const { lock } = await ctx.fns.skills.lockFile({});
    const entry = lock.packs[String(opts.name ?? "")];
    if (!entry) throw new Error(`Skill pack ${opts.name} is not installed`);
    entry.model = opts.allow === true;
    await ctx.fns.skills.lockFile({ lock });
    await ctx.fns.skills.index({ embed: false });
    return { pack: String(opts.name), model: entry.model, skills: Object.keys(entry.skills).length };
}
