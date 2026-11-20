/**
 * Carries out one button of the Skills pages for a person: install, add, update, remove a pack or one skill, allow a pack to agents
 *
 * Use from POST /skills/act only. Refuses a call that carries an agent session (skills.personOnly): these are the
 * person's decisions. `install` with a skill adds that skill to the pack of its repository (or installs the pack
 * with just it); without a skill it installs everything the repository lists, or — for an installed pack — updates
 * it. `remove` with a skill takes that one skill out of its pack and removes the pack when it was the last; without
 * a skill it removes the pack. `allow` / `deny` change whether agents may pick the pack's skills themselves. Every
 * install goes through the same preview and digest check as skills.install, taken and confirmed here in one step
 * because the person pressed the button on a page that showed what is being installed.
 * @param opts.op What to do: install, remove, allow or deny; enable or disable turns skills on or off for every agent (skills.setEnabled).
 * @param opts.repo Repository to install from.
 * @param opts.pack Installed pack to act on.
 * @param opts.skill One skill instead of the whole pack.
 * @param opts.ref Tag, branch or commit to install from instead of the newest release.
 * @param opts.all For install on an installed pack: take everything the repository lists, not only what is installed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** What to do: install, remove, allow or deny; enable or disable turns skills on or off for every agent (skills.setEnabled). */
    op: "install" | "remove" | "allow" | "deny" | "enable" | "disable";
    /** Repository to install from. */
    repo?: string;
    /** Installed pack to act on. */
    pack?: string;
    /** One skill instead of the whole pack. */
    skill?: string;
    /** Tag, branch or commit to install from instead of the newest release. */
    ref?: string;
    /** For install on an installed pack: take everything the repository lists, not only what is installed. */
    all?: boolean;
}): Promise<{ message: string; pack: string | null; skills: number }> {
    ctx.fns.skills.personOnly({ what: "change installed skills" });
    if (opts.op === "enable" || opts.op === "disable") {
        const r = await ctx.fns.skills.setEnabled({ on: opts.op === "enable" });
        return { message: r.enabled ? "Skills are on for every agent" : "Skills are off: only agents that name the skill tool have them", pack: null, skills: 0 };
    }
    const { lock } = await ctx.fns.skills.lockFile({});
    const repo = opts.repo ? (await ctx.fns.plugins.repoUrl({ repo: opts.repo })).source : opts.pack ? lock.packs[opts.pack]?.repo : undefined;
    const packName = opts.pack ?? (repo ? Object.entries(lock.packs).find(([, e]) => e.repo === repo)?.[0] : undefined);
    const pack = packName ? lock.packs[packName] : undefined;
    const skill = opts.skill ? String(opts.skill) : "";
    if (skill && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error("Not a skill name");

    const install = async (select: string[] | undefined) => {
        if (!repo) throw new Error("Nothing to install from");
        const base = { repo, ...(opts.ref ? { ref: opts.ref } : {}), ...(packName ? { as: packName } : {}), ...(select ? { select } : {}) };
        const preview = await ctx.fns.skills.install(base);
        return ctx.fns.skills.install({ ...base, confirmed: true, expectedDigest: preview.digest });
    };

    if (opts.op === "install") {
        if (skill) {
            if (pack?.skills[skill]) return { message: `${skill} is already installed`, pack: packName ?? null, skills: Object.keys(pack.skills).length };
            const done = await install([...(pack ? Object.keys(pack.skills) : []), skill]);
            return { message: `Installed ${skill} into pack ${done.pack}` + (done.model ? "" : " — it starts with /" + skill + " until agents are allowed to pick this pack"), pack: done.pack, skills: done.skills.length };
        }
        // Everything the repository lists: a selection of `*` overrides a narrower one kept in the lock.
        const done = await install(pack && !opts.all ? undefined : pack ? ["*"] : undefined);
        const added = done.skills.filter(s => s.change === "added").length, changed = done.skills.filter(s => s.change === "changed").length;
        return { message: done.operation === "install" ? `Installed pack ${done.pack}: ${done.skills.length} skills` : `Pack ${done.pack}: ${added} added, ${changed} updated, ${done.skills.length} skills now`, pack: done.pack, skills: done.skills.length };
    }
    if (!pack || !packName) throw new Error("That pack is not installed");
    if (opts.op === "allow" || opts.op === "deny") {
        const r = await ctx.fns.skills.allowModel({ name: packName, allow: opts.op === "allow" });
        return { message: r.model ? `Agents may now pick skills of ${packName} themselves` : `Skills of ${packName} now start with /name only`, pack: packName, skills: r.skills };
    }
    if (opts.op === "remove") {
        const rest = Object.keys(pack.skills).filter(name => name !== skill);
        if (!skill || !rest.length) {
            const preview = await ctx.fns.skills.uninstall({ name: packName });
            await ctx.fns.skills.uninstall({ name: packName, confirmed: true, expectedDigest: preview.digest });
            return { message: `Removed pack ${packName}`, pack: null, skills: 0 };
        }
        if (!pack.skills[skill]) return { message: `${skill} is not installed`, pack: packName, skills: Object.keys(pack.skills).length };
        // Same commit, one skill fewer: the files of the others do not move.
        const base = { repo: pack.repo, ref: pack.tag ?? pack.commit, as: packName, select: rest };
        const preview = await ctx.fns.skills.install(base);
        const done = await ctx.fns.skills.install({ ...base, confirmed: true, expectedDigest: preview.digest });
        return { message: `Removed ${skill}; pack ${packName} keeps ${done.skills.length} skills`, pack: packName, skills: done.skills.length };
    }
    throw new Error("Unknown operation");
}
