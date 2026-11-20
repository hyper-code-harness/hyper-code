const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCRIPT = /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1)$/i;

/**
 * Finds the skills of a cloned repository and checks their folders before anything is installed
 *
 * Use on a staged clone before skills.install activates it. Decides which folders are skills, in this order: the
 * author's own list in `.claude-plugin/plugin.json` (`skills`), the plugins of `.claude-plugin/marketplace.json`
 * that live in this repository (`plugins[].skills`, or `<plugin>/skills` when a plugin lists none), otherwise a walk — a SKILL.md at the root, then `skills/`, `.agents/skills/`,
 * `.claude/skills/` up to three levels deep. `select` narrows the result by skill name, by glob over the folder path,
 * or by marketplace set name. Only the chosen skill folders are checked, not the whole repository: no symbolic links,
 * no credential-like files (.env*, *.pem, *.key, id_rsa), no file over 2 MB, no skill over 20 MB or 2000 files, and
 * the SKILL.md must parse. A repository that is a Hyper plugin (package.json with a `procs` block) is refused. Nothing
 * is executed. Returns each skill with its policy, size, files that look executable, diagnostics and content hash,
 * and a digest over all of them.
 * @param opts.dir Absolute folder of the checked-out repository.
 * @param opts.select Skill names, globs over the skill folder path (`skills/engineering/*`) or marketplace set names to keep.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute folder of the checked-out repository. */
    dir: string;
    /** Skill names, globs over the skill folder path (`skills/engineering/*`) or marketplace set names to keep. */
    select?: string[];
}): Promise<{
    name: string | null;
    version: string | null;
    found: "plugin.json" | "marketplace.json" | "scan";
    skills: Array<{ name: string; path: string; description: string; modelInvocable: boolean; userInvocable: boolean; bodyChars: number; files: number; bytes: number; executables: string[]; diagnostics: string[]; hash: string }>;
    skipped: Array<{ path: string; reason: string }>;
    digest: string;
}> {
    const fs = await import("node:fs/promises");
    const { join, isAbsolute, resolve, sep, basename } = await import("node:path");
    if (!isAbsolute(opts.dir)) throw new Error("skills.inspectPack: an absolute folder is required");
    const root = await fs.realpath(opts.dir);
    const json = async (rel: string): Promise<any> => {
        const file = Bun.file(join(root, rel));
        if (!(await file.exists()) || file.size > 2_000_000) return null;
        try { return JSON.parse(await file.text()); } catch { return null; }
    };
    const pkg = await json("package.json");
    if (pkg?.procs || pkg?.proc) throw new Error("This repository is a Hyper plugin (package.json has a procs block): install it with plugins.install, not as a skill pack");

    // A manifest path is honoured only as `./relative` without `..`: it must stay inside the clone.
    const safe = (p: unknown): string | null => {
        if (typeof p !== "string") return null;
        const rel = p.replace(/^\.\//, "").replace(/\/+$/, "");
        if (p !== "." && p !== "./" && !p.startsWith("./")) return null;
        if (rel.split("/").includes("..") || rel.startsWith("/")) return null;
        return rel;
    };
    const isSkill = (rel: string) => Bun.file(join(root, rel, "SKILL.md")).exists();
    // A manifest entry names a skill folder, or a folder of skill folders.
    const expand = async (rel: string): Promise<string[]> => {
        if (await isSkill(rel)) return [rel];
        const out: string[] = [];
        for (const entry of await fs.readdir(join(root, rel), { withFileTypes: true }).catch(() => [])) {
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory() && !entry.name.startsWith(".") && await isSkill(child)) out.push(child);
        }
        return out.sort();
    };

    const plugin = await json(".claude-plugin/plugin.json");
    const market = await json(".claude-plugin/marketplace.json");
    const sets = new Map<string, string[]>();
    let found: "plugin.json" | "marketplace.json" | "scan" = "scan";
    let candidates: string[] = [];
    const listed = (value: unknown): string[] => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []).map(safe).filter((p): p is string => p !== null);
    if (plugin && listed(plugin.skills).length) {
        found = "plugin.json";
        for (const rel of listed(plugin.skills)) candidates.push(...await expand(rel));
    } else if (market && Array.isArray(market.plugins) && market.plugins.some((p: any) => typeof p?.source === "string")) {
        found = "marketplace.json";
        for (const p of market.plugins) {
            if (typeof p?.source !== "string") continue;   // an entry that lives in another repository is not part of this clone
            const paths: string[] = [];
            for (const rel of listed(p.skills)) paths.push(...await expand(rel));
            // A Claude Code plugin without a list keeps its skills in <plugin>/skills.
            const base = safe(p.source === "./" ? "." : p.source);
            if (!paths.length && base !== null) paths.push(...await expand(base ? `${base}/skills` : "skills"));
            if (typeof p.name === "string") sets.set(p.name, paths);
            candidates.push(...paths);
        }
    } else {
        if (await isSkill("")) candidates.push("");
        const walk = async (rel: string, depth: number): Promise<void> => {
            for (const entry of await fs.readdir(join(root, rel), { withFileTypes: true }).catch(() => [])) {
                if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
                const child = `${rel}/${entry.name}`;
                if (await isSkill(child)) candidates.push(child);
                else if (depth < 3) await walk(child, depth + 1);
            }
        };
        for (const base of ["skills", ".agents/skills", ".claude/skills"]) await walk(base, 1);
    }
    candidates = [...new Set(candidates)].sort();

    // `*` asks for everything the repository lists.
    const select = (opts.select ?? []).map(s => String(s).trim()).filter(Boolean).filter((s, _i, list) => !list.includes("*"));
    const bySet = new Set(select.flatMap(s => sets.get(s) ?? []));
    const globs = select.filter(s => /[*?/]/.test(s)).map(s => new Bun.Glob(s.replace(/^\.\//, "")));
    const wanted = (rel: string, name: string) => !select.length || select.includes(name) || bySet.has(rel) || globs.some(g => g.match(rel));

    const skills: Array<{ name: string; path: string; description: string; modelInvocable: boolean; userInvocable: boolean; bodyChars: number; files: number; bytes: number; executables: string[]; diagnostics: string[]; hash: string }> = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const rel of candidates) {
        const dir = resolve(root, rel);
        if (dir !== root && !dir.startsWith(root + sep)) { skipped.push({ path: rel, reason: "outside the repository" }); continue; }
        const fallback = rel ? basename(rel) : String(plugin?.name ?? basename(root));
        const parsed = await ctx.fns.skills.parse({ path: join(dir, "SKILL.md"), dirName: fallback });
        if (!parsed.ok) { skipped.push({ path: rel || ".", reason: parsed.diagnostics.at(-1) ?? "not a skill" }); continue; }
        if (!NAME.test(parsed.name)) { skipped.push({ path: rel || ".", reason: "no usable skill name" }); continue; }
        if (!wanted(rel, parsed.name)) continue;
        if (skills.some(s => s.name === parsed.name)) { skipped.push({ path: rel || ".", reason: `a second skill named ${parsed.name}` }); continue; }
        const tree = await ctx.fns.skills.hashDir({ dir });
        if (tree.links.length) throw new Error(`Skill ${parsed.name}: symbolic links are not allowed (${tree.links.slice(0, 3).join(", ")})`);
        if (tree.files.length > 2000 || tree.bytes > 20_000_000) throw new Error(`Skill ${parsed.name} exceeds the size limits (2000 files, 20 MB)`);
        const executables: string[] = [];
        for (const file of tree.files) {
            const base = basename(file);
            if (base.startsWith(".env") || /(?:^id_rsa$|\.pem$|\.key$)/i.test(base)) throw new Error(`Skill ${parsed.name}: potential credential file ${file}`);
            const stat = await fs.stat(join(dir, file));
            if (stat.size > 2_000_000) throw new Error(`Skill ${parsed.name}: ${file} is larger than 2 MB`);
            if (SCRIPT.test(file) || (stat.mode & 0o111) !== 0) executables.push(file);
        }
        skills.push({
            name: parsed.name, path: rel, description: parsed.description, modelInvocable: parsed.modelInvocable, userInvocable: parsed.userInvocable,
            bodyChars: parsed.body.length, files: tree.files.length, bytes: tree.bytes, executables, diagnostics: parsed.diagnostics, hash: tree.hash,
        });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    const digest = new Bun.CryptoHasher("sha256").update(JSON.stringify(skills.map(s => [s.name, s.path, s.hash]))).digest("hex");
    return {
        name: typeof plugin?.name === "string" ? plugin.name : typeof market?.name === "string" ? market.name : null,
        version: typeof plugin?.version === "string" ? plugin.version : null,
        found, skills, skipped, digest,
    };
}
