/**
 * Finds one skill by the name an agent or a person typed: a full `<pack>:<name>` or a short name
 *
 * Use before loading a skill. A full name matches exactly. A short name matches when exactly one skill has it; when
 * several packs ship the same name the pack named in `preferPacks` wins (a skill that calls "the grilling skill" means
 * the one of its own pack), and otherwise nothing is chosen: `candidates` lists the full names to pick from.
 * @param opts.name Skill name as typed, with or without the pack.
 * @param opts.preferPacks Packs to prefer for an ambiguous short name, most preferred first.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Skill name as typed, with or without the pack. */
    name: string;
    /** Packs to prefer for an ambiguous short name, most preferred first. */
    preferPacks?: string[];
}): Promise<{ skill: types.skills.Skill | null; candidates: string[] }> {
    const name = String(opts.name ?? "").trim().replace(/^\//, "").toLowerCase();
    if (!name || name.length > 140) return { skill: null, candidates: [] };
    const rows = await ctx.fns.skills.list({ exact: name });
    const exact = rows.find(skill => skill.id === name);
    if (exact) return { skill: exact, candidates: [] };
    const short = rows.filter(skill => skill.name === name);
    if (short.length === 1) return { skill: short[0]!, candidates: [] };
    for (const pack of opts.preferPacks ?? []) {
        const preferred = short.find(skill => skill.pack === pack);
        if (preferred) return { skill: preferred, candidates: [] };
    }
    return { skill: null, candidates: short.map(skill => skill.id) };
}
