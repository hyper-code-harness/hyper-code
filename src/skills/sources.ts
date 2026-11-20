/**
 * Lists every skill folder this instance reads: skills of installed packs and skills of the shared folders
 *
 * Use from skills.index to learn what to parse. Installed packs come from the skills lock (skills.install), each skill
 * at the folder the lock records inside ~/.hyper/skills/<pack>. Shared folders come from the `skills.roots` setting
 * (~/.agents/skills, ~/.claude/skills, ~/.codex/skills by default): every direct child with a SKILL.md is one skill
 * of the pack `local`, read in place. The same folder reached by two paths counts once, and links that point into
 * Hyper's own plugins (what external.mountSkills publishes) or into the pack folder are left out.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{
    entries: Array<{ pack: string; source: "pack" | "root"; trust: string; modelAllowed: boolean; dir: string; path: string }>;
    roots: Array<{ dir: string; exists: boolean; skills: number }>;
}> {
    const fs = await import("node:fs/promises");
    const { join, resolve, basename } = await import("node:path");
    const { homedir } = await import("node:os");
    const paths = await ctx.fns.skills.paths({});
    const entries: Array<{ pack: string; source: "pack" | "root"; trust: string; modelAllowed: boolean; dir: string; path: string }> = [];

    const { lock } = await ctx.fns.skills.lockFile({});
    for (const [pack, e] of Object.entries(lock.packs))
        for (const skill of Object.values(e.skills)) {
            const dir = resolve(paths.packs, pack, skill.path);
            entries.push({ pack, source: "pack", trust: e.trust, modelAllowed: e.model === true, dir, path: join(dir, "SKILL.md") });
        }

    const configured: unknown = await ctx.fns.settings.get({ module: "skills", scopeType: "global", key: "roots" });
    const list = (Array.isArray(configured) ? configured.map(String) : String(configured ?? "").split(/[:,\n]+/)).map(s => s.trim()).filter(Boolean);
    const home = String(ctx.env.HOME || homedir());
    const real = (p: string) => fs.realpath(p).catch(() => p);
    // What is Hyper's own must not come back in as a foreign skill.
    const own = [await real(paths.packs), ...await Promise.all((ctx.fns.procs.modules.list({}) as any[]).filter(m => m.plugin).map(m => real(String(m.dir))))];
    const seen = new Set<string>();
    const roots: Array<{ dir: string; exists: boolean; skills: number }> = [];
    for (const item of list) {
        const dir = resolve(item.replace(/^~(?=\/|$)/, home));
        const names = await fs.readdir(dir).catch(() => null);
        if (!names) { roots.push({ dir, exists: false, skills: 0 }); continue; }
        let count = 0;
        for (const name of names.sort()) {
            if (name.startsWith(".")) continue;
            const skillDir = join(dir, name);
            if (!(await Bun.file(join(skillDir, "SKILL.md")).exists())) continue;
            const target = await real(skillDir);
            if (seen.has(target) || target.includes("/.runtime/external-skills/") || own.some(o => target === o || target.startsWith(o + "/"))) continue;
            seen.add(target);
            count++;
            entries.push({ pack: "local", source: "root", trust: "local", modelAllowed: true, dir: join(dir, basename(skillDir)), path: join(skillDir, "SKILL.md") });
        }
        roots.push({ dir, exists: true, skills: count });
    }
    return { entries, roots };
}
