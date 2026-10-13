// Bring in the externals workspace.json declared but that are not on disk yet:
// a shallow clone per repo into WORKDIR/.claude/skills/<namespace> — the same
// directory the coding agent reads skills from, so a fetched module is a skill
// the moment it lands. The clone keeps its own .git and is excluded from the
// project's, so it stays updatable without ever entering the user's commits: a
// fresh checkout gets its modules back from the manifest alone.
import { appendFile, readFile } from "node:fs/promises";
/**
 * Fetch the modules subsystem operation.
 * @param opts.name The target name.
 */
export default async function (ctx: Context, _session: Session | null, opts?: { name?: string }) {
    // Registry entries are installed folders, never instructions to clone/install.
    if (await ctx.fns.procs.modules.readPluginRegistry({})) return { fetched: [] as string[] };
    const workdir = ctx.fns.procs.project.workdir({});
    const declared = await ctx.fns.procs.modules.readDeclared({ workdir });
    const fetched: string[] = [];

    for (const [namespace, config] of Object.entries(declared)) {
        if (config === false) continue;                                 // excluded: not ours to fetch
        if (opts?.name && opts.name !== namespace) continue;
        if (!config.git || config.path) continue;                       // nothing to clone
        const dir = `${workdir}/.claude/skills/${namespace}`;
        if (await declaresItself(dir)) continue;                        // already here
        const url = config.git.startsWith("github:") ? `https://github.com/${config.git.slice("github:".length)}` : config.git;
        await Bun.$`git clone --depth 1 ${url} ${dir}`.quiet();
        // A module may have dependencies of its own; Bun resolves them next to it.
        if (await Bun.file(dir + "/package.json").exists()) await Bun.$`bun install`.cwd(dir).quiet();
        await exclude(workdir, `.claude/skills/${namespace}/`);
        fetched.push(namespace);
    }
    return { fetched };
}

async function exclude(workdir: string, path: string): Promise<void> {
    const file = `${workdir}/.git/info/exclude`;
    const existing = await readFile(file, "utf8").catch(() => null);
    if (existing === null || existing.includes(path)) return;
    await appendFile(file, `\n# module fetched by the workspace\n${path}\n`);
}

// A module declares itself in the `procs` block of its own package.json
// (`atomic-workspace.json` is the older spelling, still read).
async function declaresItself(dir: string): Promise<boolean> {
    const pkg = await Bun.file(dir + "/package.json").json().catch(() => null);
    if (pkg?.procs ?? pkg?.proc) return true;
    return await Bun.file(dir + "/atomic-workspace.json").exists();
}
