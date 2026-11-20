/**
 * Reads or atomically writes the skills lock: what each installed skill pack was installed from
 *
 * Use to learn which packs skills.install put into ~/.hyper/skills, at which commit and with which skills, or (with
 * `lock`) to save a changed lock. The file is skills.lock.json in the Hyper home (skills.paths). A missing file reads
 * as an empty lock; a malformed one throws rather than being silently replaced. Writing is refused for a call that
 * carries an agent session (skills.personOnly).
 * @param opts.lock Lock to write; omit to only read.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Lock to write; omit to only read. */
    lock?: types.skills.SkillLock;
}): Promise<{ path: string; lock: types.skills.SkillLock }> {
    const fs = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const file = (await ctx.fns.skills.paths({})).lock;
    if (opts.lock) {
        ctx.fns.skills.personOnly({ what: "change the skills lock" });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(opts.lock, null, 2) + "\n");
        await fs.rename(tmp, file);
        return { path: file, lock: opts.lock };
    }
    const text = await fs.readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (text === null) return { path: file, lock: { packs: {} } };
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || !raw.packs || typeof raw.packs !== "object" || Array.isArray(raw.packs)) throw new Error("Malformed skills lock: " + file);
    for (const [name, e] of Object.entries(raw.packs) as Array<[string, any]>)
        if (!e || typeof e.repo !== "string" || !/^[0-9a-f]{40}$/.test(String(e.commit)) || !e.skills || typeof e.skills !== "object" || !Array.isArray(e.previous))
            throw new Error(`Malformed skills lock entry ${name}: ${file}`);
    return { path: file, lock: raw as types.skills.SkillLock };
}
