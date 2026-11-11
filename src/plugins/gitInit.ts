/**
 * Puts a private plugin folder in USER_PLUGINS under git as a local repository with no remote
 *
 * Use for a plugin that lives only on this machine as a plain folder in USER_PLUGINS (plugins.installed reports it as `unmanaged`), so that every installed plugin is a git repository: its history, diffs and uncommitted edits are then shown like those of an installed clone, under the `local` badge. Checks the folder with plugins.inspectPackage (the checks of an install: no symlinks, credential-like files or oversized trees), runs `git init` on branch main, keeps node_modules out through .git/info/exclude and commits every other file. It adds no remote and publishes nothing; the plugin's files are not changed, and deleting the .git folder undoes it. Refuses a folder that is already a git repository. To publish the plugin later, add a remote with git and release it with plugins.release.
 * @param opts.name Plugin name: the folder under USER_PLUGINS and the package.json name.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Plugin name: the folder under USER_PLUGINS and the package.json name. */
        name: string;
    },
): Promise<{ name: string; dir: string; branch: string; commit: string; files: string[] }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const name = String(opts.name ?? '').trim();
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid plugin name');
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!configured) throw new Error('USER_PLUGINS is not configured');
    const mount = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const dir = path.join(mount, name);
    const stat = await fs.lstat(dir).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('Plugin is not installed: ' + name);
    if ((await ctx.fns.plugins.cloneStatus({ dir })).git) throw new Error(`${name} is already a git repository`);
    if (await fs.lstat(path.join(dir, '.git')).catch(() => null)) throw new Error(`${name} has a .git that is not a working repository: repair or remove it by hand`);
    // The same structural check as an install: no symlinks, credential-like files or oversized trees get committed.
    const plugin = await ctx.fns.plugins.inspectPackage({ dir });
    if (plugin.name !== name) throw new Error(`Package is ${plugin.name}, not ${name}`);
    const git = async (args: string[], allowFail = false, env: Record<string, string> = {}) => {
        const p = Bun.spawn(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        if (code && !allowFail) throw new Error(`git ${args[0]} failed: ${(err.trim().split('\n').at(-1) ?? String(code)).slice(0, 300)}`);
        return code ? '' : out.trim();
    };
    try {
        await git(['init', '-q', '-b', 'main']);
        // node_modules is what bun installed here, not the plugin: kept out of git the way plugins.install does it.
        await fs.writeFile(path.join(dir, '.git', 'info', 'exclude'), '/node_modules/\n');
        await git(['add', '-A']);
        // A machine without a git identity still gets its commit, authored by Hyper.
        const known = await git(['config', 'user.name'], true) && await git(['config', 'user.email'], true);
        const who: Record<string, string> = known ? {} : { GIT_AUTHOR_NAME: 'Hyper', GIT_AUTHOR_EMAIL: 'hyper@localhost', GIT_COMMITTER_NAME: 'Hyper', GIT_COMMITTER_EMAIL: 'hyper@localhost' };
        await git(['commit', '-q', '-m', `${name}: local plugin under git`], false, who);
        return { name, dir, branch: 'main', commit: await git(['rev-parse', 'HEAD']), files: (await git(['ls-files'])).split('\n').filter(Boolean) };
    } catch (cause) {
        // Half a repository is worse than none: the folder is left exactly as it was.
        await fs.rm(path.join(dir, '.git'), { recursive: true, force: true });
        throw cause;
    }
}
